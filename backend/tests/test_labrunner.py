"""Lab runner safety boundary (pure-Python parts; no namespaces are created here)."""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("labrunner", ROOT / "labrunner" / "fiberscope_labrunner.py")
lr = importlib.util.module_from_spec(spec)
sys.modules["labrunner"] = lr
spec.loader.exec_module(lr)


@pytest.fixture(autouse=True)
def _state(tmp_path, monkeypatch):
    monkeypatch.setattr(lr, "STATE_DIR", tmp_path)
    monkeypatch.setattr(lr, "AUDIT_LOG", tmp_path / "audit.jsonl")
    lr.save_owned({"namespaces": list(lr.NAMESPACES), "impairments": {"fs-imp-0001": {"iface": "asw-1:Ethernet1/49"}}})


OWNED = lambda ns, dev: f"{lr.OWNER_ALIAS}:{ns}:{dev}"  # noqa: E731
FOREIGN = lambda ns, dev: None  # noqa: E731


def test_unsupported_op_and_action_rejected():
    with pytest.raises(lr.LabError) as e:
        lr.handle({"op": "shell", "action": "ls"})
    assert e.value.code == "unsupported_op"
    with pytest.raises(lr.LabError) as e:
        lr.build_diagnostic("exec", {}, {})
    assert e.value.code == "unsupported_action"


def test_unknown_request_fields_rejected():
    with pytest.raises(lr.LabError):
        lr.handle({"op": "diagnostic", "action": "reachability", "cmd": "id"})


@pytest.mark.parametrize("target", [{"src": "srv-a", "dst": "8.8.8.8"}, {"src": "srv-a;id", "dst": "srv-b"}, {"src": "srv-a", "dst": "srv-a"}])
def test_hosts_must_be_allowlisted(target):
    with pytest.raises(lr.LabError):
        lr.build_diagnostic("reachability", target, {})


def test_commands_are_argv_lists_scoped_to_lab_namespaces():
    cmds, timeout = lr.build_diagnostic("reachability", {"src": "srv-a", "dst": "srv-b"}, {"count": 5, "payload_bytes": 1472, "dont_fragment": True, "ip_version": 4})
    argv = cmds[0]
    assert argv[:4] == ["ip", "netns", "exec", "fslab-srva"] and argv[-1] == "192.0.2.12"
    assert "-M" in argv and timeout <= 60
    for action, tgt in (("interface_state", {"interface": "asw-1:Ethernet1/1"}), ("vlan_membership", {"device": "asw-2"})):
        argv = lr.build_diagnostic(action, tgt, {})[0][0]
        assert any(a.startswith("fslab-") for a in argv)


def test_non_owned_interface_rejected():
    with pytest.raises(lr.LabError) as e:
        lr.build_diagnostic("interface_state", {"interface": "host:eth0"}, {})
    assert e.value.code == "not_owned"
    with pytest.raises(lr.LabError) as e:
        lr.build_repair("enable_interface", {"interface": "asw-1:Ethernet1/1"}, {}, alias_lookup=FOREIGN)
    assert e.value.code == "not_owned"
    assert lr.build_repair("enable_interface", {"interface": "asw-1:Ethernet1/1"}, {}, alias_lookup=OWNED)[0][-1] == "up"


def test_namespace_not_recorded_is_rejected():
    lr.save_owned({"namespaces": [], "impairments": {}})
    with pytest.raises(lr.LabError) as e:
        lr.build_fault("admin-down", alias_lookup=OWNED)
    assert e.value.code == "not_owned"


def test_non_lab_namespace_cannot_be_targeted():
    with pytest.raises(lr.LabError):
        lr.ns_ip("default", "link")


def test_unowned_impairment_rejected():
    with pytest.raises(lr.LabError) as e:
        lr.build_repair("remove_impairment", {"impairment_id": "fs-imp-0002"}, {}, alias_lookup=OWNED)
    assert e.value.code == "not_owned"
    with pytest.raises(lr.LabError):
        lr.build_repair("remove_impairment", {"impairment_id": "../../etc"}, {}, alias_lookup=OWNED)


def test_bounds_enforced():
    with pytest.raises(lr.LabError):
        lr.build_diagnostic("reachability", {"src": "srv-a", "dst": "srv-b"}, {"count": 5000})
    with pytest.raises(lr.LabError):
        lr.build_diagnostic("throughput", {"src": "srv-a", "dst": "srv-b"}, {"duration_s": 120})
    with pytest.raises(lr.LabError):
        lr.build_diagnostic("mtu_probe", {"src": "srv-a", "dst": "srv-b"}, {"payload_sizes": [56, "1472;id"]})


def test_execution_timeout_enforced():
    res = lr.run_argv([sys.executable, "-c", "import time; time.sleep(5)"], timeout=0.5)
    assert res.timed_out and res.rc == -1 and res.duration_s < 3
    lines = (lr.AUDIT_LOG).read_text().splitlines()
    assert json.loads(lines[-1])["timed_out"] is True


def test_run_argv_rejects_shell_strings():
    with pytest.raises(lr.LabError):
        lr.run_argv("ping -c1 192.0.2.12; reboot", timeout=1)  # type: ignore[arg-type]


def test_output_is_bounded():
    res = lr.run_argv([sys.executable, "-c", "print('x' * 200000)"], timeout=5)
    assert len(res.stdout) <= lr.MAX_OUTPUT


def test_setup_refuses_without_linux_root_and_activation(monkeypatch):
    monkeypatch.delenv("FIBERSCOPE_LAB_ENABLE", raising=False)
    with pytest.raises(lr.LabError) as e:
        lr.require_environment()
    assert e.value.code == "environment"
    assert lr.main(["setup"]) == 2  # missing --i-understand


def test_lab_parsers():
    from app.lab import parsers

    ping = "PING 192.0.2.12 (192.0.2.12) 56(84) bytes of data.\n--- 192.0.2.12 ping statistics ---\n10 packets transmitted, 8 received, 20% packet loss, time 1803ms\nrtt min/avg/max/mdev = 0.031/0.048/0.072/0.011 ms\n"
    p = parsers.parse_ping(ping)
    assert p["loss_pct"] == 20 and p["failure_mode"] == "partial_loss" and p["rtt_ms"]["avg"] == 0.048
    dhu = "From 192.0.2.11 icmp_seq=1 Destination Host Unreachable\n--- 192.0.2.12 ping statistics ---\n3 packets transmitted, 0 received, +3 errors, 100% packet loss, time 2030ms\n"
    assert parsers.parse_ping(dhu)["failure_mode"] == "neighbor_unresolved"
    link = json.dumps([{"ifname": "p1", "flags": ["BROADCAST", "MULTICAST"], "mtu": 9216, "operstate": "DOWN", "ifalias": "fiberscope-owned:x"}])
    assert parsers.parse_link(link)["admin_state"] == "down"
    vl = json.dumps([{"ifname": "p1", "vlans": [{"vlan": 30, "flags": ["PVID", "Egress Untagged"]}]}, {"ifname": "up", "vlans": [{"vlan": 20}, {"vlan": 30}]}])
    v = parsers.parse_bridge_vlans(vl)
    assert v["p1"]["pvid"] == 30 and v["up"]["tagged"] == [20, 30]
    q = json.dumps([{"kind": "netem", "handle": "8001:", "options": {"loss-random": {"loss": 0.15}}, "drops": 14, "packets": 100}])
    assert parsers.parse_qdisc(q)[0]["loss_pct"] == 15.0
    ip = json.dumps({"end": {"sum_sent": {"bits_per_second": 9.4e9, "retransmits": 3}, "sum_received": {"bits_per_second": 9.39e9}}, "intervals": []})
    assert parsers.parse_iperf(ip)["sender_gbps"] == 9.4

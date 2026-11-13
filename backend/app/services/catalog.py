"""Fixed diagnostic and repair action catalog.

The UI offers a *structured action palette*, never a free-form terminal. Every action has a
schema with bounded parameters; requests are validated here before any executor sees them.
Arbitrary command strings are never accepted — ``command`` fields are always *rendered* from
validated parameters for display.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

HOSTS = ("srv-a", "srv-b", "gw-1")
DEVICES = ("srv-a", "srv-b", "asw-1", "asw-2", "gw-1")


class ActionError(ValueError):
    def __init__(self, code: str, message: str, details: Any = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------- targets


class HostPairTarget(_Strict):
    src: Literal["srv-a", "srv-b", "gw-1"]
    dst: Literal["srv-a", "srv-b", "gw-1"]

    @field_validator("dst")
    @classmethod
    def _distinct(cls, v: str, info):  # noqa: ANN001
        if info.data.get("src") == v:
            raise ValueError("source and destination must differ")
        return v


class InterfaceTarget(_Strict):
    interface: str = Field(min_length=3, max_length=96, pattern=r"^[a-z0-9-]+:[A-Za-z0-9/._-]+$")


class DeviceTarget(_Strict):
    device: Literal["srv-a", "srv-b", "asw-1", "asw-2", "gw-1"]


class LocationTarget(_Strict):
    location: str = Field(min_length=3, max_length=96, pattern=r"^[a-z0-9-]+:[A-Za-z0-9/._-]+$")


# --------------------------------------------------------------------------- params


class NoParams(_Strict):
    pass


class PingParams(_Strict):
    count: int = Field(default=10, ge=1, le=200)
    payload_bytes: int = Field(default=56, ge=0, le=8972)
    dont_fragment: bool = False
    ip_version: Literal[4, 6] = 4


class ThroughputParams(_Strict):
    duration_s: int = Field(default=10, ge=1, le=10)
    parallel: int = Field(default=1, ge=1, le=4)


class MtuProbeParams(_Strict):
    payload_sizes: list[int] = Field(default_factory=lambda: [56, 1472, 8972], min_length=1, max_length=6)
    ip_version: Literal[4, 6] = 4
    count: int = Field(default=3, ge=1, le=5)

    @field_validator("payload_sizes")
    @classmethod
    def _bounded(cls, v: list[int]) -> list[int]:
        for s in v:
            if s < 0 or s > 8972:
                raise ValueError("payload sizes must be between 0 and 8972 bytes")
        return v


class VlanRepairParams(_Strict):
    vlan: int = Field(ge=1, le=4094)


class MtuRepairParams(_Strict):
    mtu: int = Field(ge=576, le=9216)


class ImpairmentTarget(_Strict):
    impairment_id: str = Field(pattern=r"^fs-imp-[0-9]{4}$")


# --------------------------------------------------------------------------- catalog

DIAGNOSTIC_ACTIONS: dict[str, dict[str, Any]] = {
    "reachability": {
        "label": "Check reachability",
        "icon": "radar",
        "purpose": "Send ICMP echo probes between two endpoints to test end-to-end IP reachability.",
        "target": HostPairTarget,
        "params": PingParams,
        "modes": ["SIMULATED", "LINUX_LAB"],
        "layer": "L3",
    },
    "interface_state": {
        "label": "Inspect interface state",
        "icon": "plug",
        "purpose": "Read administrative state (configured) and operational/link state (observed) separately.",
        "target": InterfaceTarget,
        "params": NoParams,
        "modes": ["SIMULATED", "LINUX_LAB"],
        "layer": "L1/L2",
    },
    "interface_counters": {
        "label": "Inspect interface counters",
        "icon": "gauge",
        "purpose": "Read packet, error, discard and oversize counters for an interface.",
        "target": InterfaceTarget,
        "params": NoParams,
        "modes": ["SIMULATED", "LINUX_LAB"],
        "layer": "L1/L2",
    },
    "vlan_membership": {
        "label": "Inspect VLAN membership",
        "icon": "layers",
        "purpose": "Show running VLAN membership per port and compare it to documented intent.",
        "target": DeviceTarget,
        "params": NoParams,
        "modes": ["SIMULATED", "LINUX_LAB"],
        "layer": "L2",
    },
    "neighbor_table": {
        "label": "Inspect neighbor table",
        "icon": "network",
        "purpose": "Show ARP/ND neighbor entries (hosts) or learned MAC addresses (switches).",
        "target": DeviceTarget,
        "params": NoParams,
        "modes": ["SIMULATED", "LINUX_LAB"],
        "layer": "L2/L3",
    },
    "routing": {
        "label": "Inspect routing information",
        "icon": "route",
        "purpose": "Show the routing table to confirm the destination is on-link or via the expected gateway.",
        "target": DeviceTarget,
        "params": NoParams,
        "modes": ["SIMULATED", "LINUX_LAB"],
        "layer": "L3",
    },
    "throughput": {
        "label": "Run bounded throughput test",
        "icon": "activity",
        "purpose": "Run a short, bounded TCP throughput test (max 10 s, max 4 streams).",
        "target": HostPairTarget,
        "params": ThroughputParams,
        "modes": ["SIMULATED", "LINUX_LAB"],
        "layer": "L4",
    },
    "mtu_probe": {
        "label": "Run MTU probe",
        "icon": "ruler",
        "purpose": "Send don't-fragment probes of increasing size to find the largest packet the path carries.",
        "target": HostPairTarget,
        "params": MtuProbeParams,
        "modes": ["SIMULATED", "LINUX_LAB"],
        "layer": "L3",
    },
    "optical_telemetry": {
        "label": "Read optical telemetry",
        "icon": "sun",
        "purpose": "Read transceiver DOM values (Tx/Rx power, temperature, voltage, bias) with the module's own thresholds.",
        "target": InterfaceTarget,
        "params": NoParams,
        "modes": ["SIMULATED"],
        "layer": "L1",
    },
    "cable_trace": {
        "label": "Trace documented cable path",
        "icon": "cable",
        "purpose": "Trace the documented physical path (patch cords, panel mappings, trunk) from the cable registry.",
        "target": InterfaceTarget,
        "params": NoParams,
        "modes": ["SIMULATED", "LINUX_LAB"],
        "layer": "L1 (records)",
    },
    "impairment_inspect": {
        "label": "Inspect lab impairment rules",
        "icon": "filter",
        "purpose": "List traffic-control (tc/netem) rules on a lab interface, including owned impairment rules.",
        "target": InterfaceTarget,
        "params": NoParams,
        "modes": ["SIMULATED", "LINUX_LAB"],
        "layer": "Lab control",
    },
    "connector_inspection": {
        "label": "Inspect connector end-face (scope)",
        "icon": "scan-eye",
        "purpose": "Record a fiber inspection-scope check at a mated connection point. Never look into a connector or port.",
        "target": LocationTarget,
        "params": NoParams,
        "modes": ["SIMULATED"],
        "layer": "L1 (physical)",
    },
}

REPAIR_ACTIONS: dict[str, dict[str, Any]] = {
    "set_access_vlan": {
        "label": "Set access VLAN",
        "description": "Change the access VLAN on one switch port.",
        "target": InterfaceTarget,
        "params": VlanRepairParams,
        "modes": ["SIMULATED", "LINUX_LAB"],
    },
    "enable_interface": {
        "label": "Enable interface",
        "description": "Administratively enable one interface (no shutdown / ip link set up).",
        "target": InterfaceTarget,
        "params": NoParams,
        "modes": ["SIMULATED", "LINUX_LAB"],
    },
    "remove_impairment": {
        "label": "Remove owned impairment rule",
        "description": "Delete a FiberScope-owned tc/netem rule after verifying ownership.",
        "target": ImpairmentTarget,
        "params": NoParams,
        "modes": ["SIMULATED", "LINUX_LAB"],
    },
    "set_mtu": {
        "label": "Set interface MTU",
        "description": "Set MTU on one interface to the documented intended value.",
        "target": InterfaceTarget,
        "params": MtuRepairParams,
        "modes": ["SIMULATED", "LINUX_LAB"],
    },
    "clean_connector": {
        "label": "Clean connector (recorded procedure)",
        "description": "Record an inspect–clean–reinspect procedure at a mated connection point.",
        "target": LocationTarget,
        "params": NoParams,
        "modes": ["SIMULATED"],
    },
    "replace_patch_cable": {
        "label": "Replace patch cable",
        "description": "Record replacement of one patch cord with a like-for-like spare.",
        "target": _Strict,  # replaced below
        "params": NoParams,
        "modes": ["SIMULATED"],
    },
    "replace_optic": {
        "label": "Replace optic",
        "description": "Record replacement of the transceiver in one port with a like-for-like spare.",
        "target": InterfaceTarget,
        "params": NoParams,
        "modes": ["SIMULATED"],
    },
}


class CableTarget(_Strict):
    cable_id: str = Field(pattern=r"^(CBL|TRK)-[A-Z0-9-]{2,20}$")


REPAIR_ACTIONS["replace_patch_cable"]["target"] = CableTarget


def validate_action(
    catalog: dict[str, dict[str, Any]], action: str, target: Any, params: Any, mode: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    if not isinstance(action, str) or action not in catalog:
        raise ActionError("unsupported_action", f"Unsupported action '{action}'.")
    spec = catalog[action]
    if mode not in spec["modes"]:
        raise ActionError("unsupported_in_mode", f"Action '{action}' is not available in {mode} mode.")
    if not isinstance(target, dict):
        raise ActionError("invalid_target", "Target must be an object.")
    if params is None:
        params = {}
    if not isinstance(params, dict):
        raise ActionError("invalid_params", "Params must be an object.")
    try:
        t = spec["target"].model_validate(target).model_dump()
        p = spec["params"].model_validate(params).model_dump()
    except ValidationError as exc:
        raise ActionError("invalid_request", "Action target or parameters are invalid.", exc.errors(include_url=False)) from exc
    return t, p


def catalog_for_client(catalog: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for key, spec in catalog.items():
        out.append(
            {
                "key": key,
                "label": spec["label"],
                "purpose": spec.get("purpose", spec.get("description", "")),
                "icon": spec.get("icon"),
                "layer": spec.get("layer"),
                "modes": spec["modes"],
                "target_schema": spec["target"].model_json_schema(),
                "params_schema": spec["params"].model_json_schema(),
            }
        )
    return out

"""North Lab Fabric — the fictional seed environment.

Everything here is a *documented inventory fixture*. Patch panels and the fiber trunk are
modeled for documentation/path-tracing purposes; they are not physically present in either
simulation or the optional Linux lab (which uses veth pairs).

Addresses use documentation ranges only:
  * 192.0.2.0/24     (TEST-NET-1)   — VLAN 20 application data
  * 203.0.113.0/24   (TEST-NET-3)   — VLAN 30 storage
  * 198.51.100.0/24  (TEST-NET-2)   — out-of-band management
  * 2001:db8::/32    (IPv6 documentation prefix)
MAC addresses are locally administered (02:...) fixture values.
"""
from __future__ import annotations

ENVIRONMENT = {
    "id": "north-lab-fabric",
    "name": "North Lab Fabric",
    "description": (
        "Fictional two-rack lab fabric: two servers, two access switches joined by a fiber uplink, "
        "a gateway, and a modeled patch-panel/trunk path between racks R01 and R02."
    ),
}

VLANS = [
    {"id": 20, "name": "APP-DATA", "ipv4_subnet": "192.0.2.0/24", "ipv6_subnet": "2001:db8:20::/64",
     "gateway_ipv4": "192.0.2.1", "description": "Application data VLAN between Server A and Server B."},
    {"id": 30, "name": "STORAGE", "ipv4_subnet": "203.0.113.0/24", "ipv6_subnet": "2001:db8:30::/64",
     "gateway_ipv4": None, "description": "Storage VLAN (no members in the healthy baseline)."},
]

DEVICES = [
    {"id": "srv-a", "name": "Server A", "role": "server", "rack": "R01", "rack_unit": "U12",
     "model": "Generic 1U compute node (modeled)", "mgmt_address": "198.51.100.11",
     "notes": "Application client. Data NIC eth0 (25G SR optic); BMC on out-of-band network."},
    {"id": "srv-b", "name": "Server B", "role": "server", "rack": "R01", "rack_unit": "U14",
     "model": "Generic 1U compute node (modeled)", "mgmt_address": "198.51.100.12",
     "notes": "Application server. Third-party optic reports DOM values but no thresholds."},
    {"id": "pp-01", "name": "Patch Panel PP-01", "role": "patch_panel", "rack": "R01", "rack_unit": "U1",
     "model": "1U LC fiber panel, MPO cassette (modeled)", "is_passive": True, "is_modeled_only": True,
     "notes": "Passive front↔rear mapping only. Not an IP device."},
    {"id": "pp-02", "name": "Patch Panel PP-02", "role": "patch_panel", "rack": "R02", "rack_unit": "U1",
     "model": "1U LC fiber panel, MPO cassette (modeled)", "is_passive": True, "is_modeled_only": True,
     "notes": "Passive front↔rear mapping only. Not an IP device."},
    {"id": "asw-1", "name": "Access Switch 1", "role": "access_switch", "rack": "R02", "rack_unit": "U40",
     "model": "Generic 48x25G + 2 uplink ToR (modeled)", "mgmt_address": "198.51.100.21",
     "notes": "Serves Server A. Uplink Eth1/49 to Access Switch 2; Eth1/50 to gateway."},
    {"id": "asw-2", "name": "Access Switch 2", "role": "access_switch", "rack": "R02", "rack_unit": "U38",
     "model": "Generic 48x25G + 2 uplink ToR (modeled)", "mgmt_address": "198.51.100.22",
     "notes": "Serves Server B. Uplink Eth1/49 to Access Switch 1."},
    {"id": "gw-1", "name": "Gateway", "role": "gateway", "rack": "R02", "rack_unit": "U42",
     "model": "Generic L3 gateway (modeled, optional)", "mgmt_address": "198.51.100.1",
     "notes": "Default gateway for VLAN 20 (192.0.2.1). Optional node."},
]

_MTU_HOST = 9000
_MTU_SW = 9216

INTERFACES = [
    # Server A
    {"device_id": "srv-a", "name": "eth0", "kind": "data", "media": "fiber", "speed_gbps": 25,
     "mac": "02:00:5e:10:00:11", "ipv4_cidr": "192.0.2.11/24", "ipv6_cidr": "2001:db8:20::11/64",
     "intended_mtu": _MTU_HOST, "description": "Data NIC → CBL-F101 → PP-01 F01"},
    {"device_id": "srv-a", "name": "bmc0", "kind": "mgmt", "media": "copper", "speed_gbps": 1,
     "mac": "02:00:5e:90:00:11", "ipv4_cidr": "198.51.100.11/24", "intended_mtu": 1500,
     "description": "Out-of-band management (modeled, not cabled in this lab)"},
    # Server B
    {"device_id": "srv-b", "name": "eth0", "kind": "data", "media": "fiber", "speed_gbps": 25,
     "mac": "02:00:5e:10:00:12", "ipv4_cidr": "192.0.2.12/24", "ipv6_cidr": "2001:db8:20::12/64",
     "intended_mtu": _MTU_HOST, "description": "Data NIC → CBL-F102 → PP-01 F02"},
    {"device_id": "srv-b", "name": "bmc0", "kind": "mgmt", "media": "copper", "speed_gbps": 1,
     "mac": "02:00:5e:90:00:12", "ipv4_cidr": "198.51.100.12/24", "intended_mtu": 1500,
     "description": "Out-of-band management (modeled, not cabled in this lab)"},
    # Patch panel PP-01 (rack R01)
    *[
        {"device_id": "pp-01", "name": f"{side}{n:02d}", "kind": "patch_front" if side == "F" else "patch_rear",
         "media": "fiber", "description": f"{'Front LC duplex' if side == 'F' else 'Rear (MPO cassette)'} port {n}"}
        for n in (1, 2, 3) for side in ("F", "R")
    ],
    # Patch panel PP-02 (rack R02)
    *[
        {"device_id": "pp-02", "name": f"{side}{n:02d}", "kind": "patch_front" if side == "F" else "patch_rear",
         "media": "fiber", "description": f"{'Front LC duplex' if side == 'F' else 'Rear (MPO cassette)'} port {n}"}
        for n in (1, 2, 3) for side in ("F", "R")
    ],
    # Access Switch 1
    {"device_id": "asw-1", "name": "Ethernet1/1", "kind": "data", "media": "fiber", "speed_gbps": 25,
     "mac": "02:00:5e:21:01:01", "switchport_mode": "access", "intended_vlan": 20, "intended_mtu": _MTU_SW,
     "description": "srv-a eth0 via PP-02 F01"},
    {"device_id": "asw-1", "name": "Ethernet1/49", "kind": "uplink", "media": "fiber", "speed_gbps": 25,
     "mac": "02:00:5e:21:01:49", "switchport_mode": "trunk", "intended_allowed_vlans": [20, 30],
     "intended_mtu": _MTU_SW, "description": "Uplink to asw-2 Eth1/49 (CBL-F301)"},
    {"device_id": "asw-1", "name": "Ethernet1/50", "kind": "uplink", "media": "dac", "speed_gbps": 25,
     "mac": "02:00:5e:21:01:50", "switchport_mode": "trunk", "intended_allowed_vlans": [20],
     "intended_mtu": _MTU_SW, "description": "To gateway gw-1 xe-0/0/0 (CBL-D401)"},
    {"device_id": "asw-1", "name": "mgmt0", "kind": "mgmt", "media": "copper", "speed_gbps": 1,
     "mac": "02:00:5e:91:00:21", "ipv4_cidr": "198.51.100.21/24", "intended_mtu": 1500,
     "description": "Out-of-band management (modeled)"},
    # Access Switch 2
    {"device_id": "asw-2", "name": "Ethernet1/1", "kind": "data", "media": "fiber", "speed_gbps": 25,
     "mac": "02:00:5e:22:01:01", "switchport_mode": "access", "intended_vlan": 20, "intended_mtu": _MTU_SW,
     "description": "srv-b eth0 via PP-02 F02"},
    {"device_id": "asw-2", "name": "Ethernet1/49", "kind": "uplink", "media": "fiber", "speed_gbps": 25,
     "mac": "02:00:5e:22:01:49", "switchport_mode": "trunk", "intended_allowed_vlans": [20, 30],
     "intended_mtu": _MTU_SW, "description": "Uplink to asw-1 Eth1/49 (CBL-F301)"},
    {"device_id": "asw-2", "name": "Ethernet1/2", "kind": "data", "media": "fiber", "speed_gbps": 25,
     "mac": "02:00:5e:22:01:02", "switchport_mode": "access", "intended_vlan": 30, "intended_mtu": _MTU_SW,
     "description": "Reserved storage port (no cable)"},
    {"device_id": "asw-2", "name": "mgmt0", "kind": "mgmt", "media": "copper", "speed_gbps": 1,
     "mac": "02:00:5e:91:00:22", "ipv4_cidr": "198.51.100.22/24", "intended_mtu": 1500,
     "description": "Out-of-band management (modeled)"},
    # Gateway
    {"device_id": "gw-1", "name": "xe-0/0/0", "kind": "routed", "media": "dac", "speed_gbps": 25,
     "mac": "02:00:5e:30:00:01", "ipv4_cidr": "192.0.2.1/24", "ipv6_cidr": "2001:db8:20::1/64",
     "switchport_mode": "routed", "intended_vlan": 20, "intended_mtu": _MTU_SW,
     "description": "802.1Q sub-interface unit 20 (VLAN 20 gateway)"},
    {"device_id": "gw-1", "name": "mgmt0", "kind": "mgmt", "media": "copper", "speed_gbps": 1,
     "mac": "02:00:5e:91:00:01", "ipv4_cidr": "198.51.100.1/24", "intended_mtu": 1500,
     "description": "Out-of-band management (modeled)"},
]

PATCH_MAPPINGS = [
    {"panel": "pp-01", "front": "F01", "rear": "R01"},
    {"panel": "pp-01", "front": "F02", "rear": "R02"},
    {"panel": "pp-01", "front": "F03", "rear": "R03"},
    {"panel": "pp-02", "front": "F01", "rear": "R01"},
    {"panel": "pp-02", "front": "F02", "rear": "R02"},
    {"panel": "pp-02", "front": "F03", "rear": "R03"},
]

_OM4 = "OM4 multimode 50/125 µm"
_OS2 = "OS2 single-mode 9/125 µm"

CABLES = [
    {"id": "CBL-F101", "kind": "patch", "media": "fiber", "fiber_type": _OM4, "connector_a": "LC/UPC duplex",
     "connector_b": "LC/UPC duplex", "nominal_length_m": 3.0, "label_status": "labeled",
     "a": "srv-a:eth0", "b": "pp-01:F01", "notes": "Server A data patch to rack R01 panel."},
    {"id": "CBL-F102", "kind": "patch", "media": "fiber", "fiber_type": _OM4, "connector_a": "LC/UPC duplex",
     "connector_b": "LC/UPC duplex", "nominal_length_m": 3.0, "label_status": "missing",
     "a": "srv-b:eth0", "b": "pp-01:F02", "notes": "Label missing at server end during last audit (fixture)."},
    {"id": "TRK-0102-P1", "kind": "trunk_pair", "trunk_id": "TRK-0102", "media": "fiber", "fiber_type": _OM4,
     "connector_a": "MPO-12 via LC cassette", "connector_b": "MPO-12 via LC cassette", "nominal_length_m": 30.0,
     "label_status": "labeled", "a": "pp-01:R01", "b": "pp-02:R01",
     "notes": "Trunk TRK-0102 fiber pair 1 (strands 1/12). Modeled inter-rack trunk."},
    {"id": "TRK-0102-P2", "kind": "trunk_pair", "trunk_id": "TRK-0102", "media": "fiber", "fiber_type": _OM4,
     "connector_a": "MPO-12 via LC cassette", "connector_b": "MPO-12 via LC cassette", "nominal_length_m": 30.0,
     "label_status": "labeled", "a": "pp-01:R02", "b": "pp-02:R02",
     "notes": "Trunk TRK-0102 fiber pair 2 (strands 2/11). Modeled inter-rack trunk."},
    {"id": "TRK-0102-P3", "kind": "trunk_pair", "trunk_id": "TRK-0102", "media": "fiber", "fiber_type": _OM4,
     "connector_a": "MPO-12 via LC cassette", "connector_b": "MPO-12 via LC cassette", "nominal_length_m": 30.0,
     "label_status": "labeled", "a": "pp-01:R03", "b": "pp-02:R03",
     "notes": "Trunk TRK-0102 fiber pair 3 — spare, front ports unpatched."},
    {"id": "CBL-F201", "kind": "patch", "media": "fiber", "fiber_type": _OM4, "connector_a": "LC/UPC duplex",
     "connector_b": "LC/UPC duplex", "nominal_length_m": 2.0, "label_status": "labeled",
     "a": "pp-02:F01", "b": "asw-1:Ethernet1/1", "notes": "Rack R02 patch to Access Switch 1."},
    {"id": "CBL-F202", "kind": "patch", "media": "fiber", "fiber_type": _OM4, "connector_a": "LC/UPC duplex",
     "connector_b": "LC/UPC duplex", "nominal_length_m": 2.0, "label_status": "labeled",
     "a": "pp-02:F02", "b": "asw-2:Ethernet1/1", "notes": "Rack R02 patch to Access Switch 2."},
    {"id": "CBL-F301", "kind": "direct", "media": "fiber", "fiber_type": _OS2, "connector_a": "LC/UPC duplex",
     "connector_b": "LC/UPC duplex", "nominal_length_m": 1.0, "label_status": "labeled",
     "a": "asw-1:Ethernet1/49", "b": "asw-2:Ethernet1/49", "notes": "Inter-switch uplink, same rack."},
    {"id": "CBL-D401", "kind": "direct", "media": "dac", "fiber_type": None, "connector_a": "SFP28 DAC",
     "connector_b": "SFP28 DAC", "nominal_length_m": 1.0, "label_status": "labeled",
     "a": "asw-1:Ethernet1/50", "b": "gw-1:xe-0/0/0", "notes": "Passive DAC — no optical DOM."},
]

# Thresholds are illustrative *fixture* values for this lab's modeled optics. Real thresholds are
# per-module (read from the transceiver EEPROM) and must never be assumed universal.
_SR_THRESHOLDS = {
    "rx_power_dbm": {"low_alarm": -13.9, "low_warning": -9.9, "high_warning": 2.4, "high_alarm": 3.4},
    "tx_power_dbm": {"low_alarm": -9.4, "low_warning": -8.4, "high_warning": 2.4, "high_alarm": 3.4},
    "temperature_c": {"low_alarm": -5.0, "low_warning": 0.0, "high_warning": 70.0, "high_alarm": 75.0},
    "voltage_v": {"low_alarm": 2.97, "low_warning": 3.13, "high_warning": 3.47, "high_alarm": 3.63},
    "bias_ma": {"low_alarm": 2.0, "low_warning": 3.0, "high_warning": 11.0, "high_alarm": 12.0},
}
_LR_THRESHOLDS = {
    "rx_power_dbm": {"low_alarm": -15.4, "low_warning": -13.4, "high_warning": 0.5, "high_alarm": 2.5},
    "tx_power_dbm": {"low_alarm": -8.2, "low_warning": -7.2, "high_warning": 0.5, "high_alarm": 1.5},
    "temperature_c": {"low_alarm": -5.0, "low_warning": 0.0, "high_warning": 70.0, "high_alarm": 75.0},
    "voltage_v": {"low_alarm": 2.97, "low_warning": 3.13, "high_warning": 3.47, "high_alarm": 3.63},
    "bias_ma": {"low_alarm": 10.0, "low_warning": 15.0, "high_warning": 70.0, "high_alarm": 80.0},
}
_THRESH_SRC = "Module EEPROM alarm/warning fields (simulation fixture values)"

OPTICS = [
    {"id": "OPT-SA-E0", "interface": "srv-a:eth0", "vendor": "Generic (fixture)", "part_number": "SFP28-SR-FX",
     "serial": "FX25SR0011", "form_factor": "SFP28", "standard": "25GBASE-SR", "wavelength_nm": 850,
     "dom_supported": True, "thresholds": _SR_THRESHOLDS, "threshold_source": _THRESH_SRC},
    {"id": "OPT-SB-E0", "interface": "srv-b:eth0", "vendor": "Third-party (fixture)", "part_number": "SFP28-SR-TP",
     "serial": "TP25SR0012", "form_factor": "SFP28", "standard": "25GBASE-SR", "wavelength_nm": 850,
     "dom_supported": True, "thresholds": None,
     "threshold_source": "Not reported by module — thresholds unknown"},
    {"id": "OPT-A1-11", "interface": "asw-1:Ethernet1/1", "vendor": "Generic (fixture)", "part_number": "SFP28-SR-FX",
     "serial": "FX25SR0101", "form_factor": "SFP28", "standard": "25GBASE-SR", "wavelength_nm": 850,
     "dom_supported": True, "thresholds": _SR_THRESHOLDS, "threshold_source": _THRESH_SRC},
    {"id": "OPT-A1-149", "interface": "asw-1:Ethernet1/49", "vendor": "Generic (fixture)", "part_number": "SFP28-LR-FX",
     "serial": "FX25LR0149", "form_factor": "SFP28", "standard": "25GBASE-LR", "wavelength_nm": 1310,
     "dom_supported": True, "thresholds": _LR_THRESHOLDS, "threshold_source": _THRESH_SRC},
    {"id": "OPT-A2-11", "interface": "asw-2:Ethernet1/1", "vendor": "Generic (fixture)", "part_number": "SFP28-SR-FX",
     "serial": "FX25SR0201", "form_factor": "SFP28", "standard": "25GBASE-SR", "wavelength_nm": 850,
     "dom_supported": True, "thresholds": _SR_THRESHOLDS, "threshold_source": _THRESH_SRC},
    {"id": "OPT-A2-149", "interface": "asw-2:Ethernet1/49", "vendor": "Generic (fixture)", "part_number": "SFP28-LR-FX",
     "serial": "FX25LR0249", "form_factor": "SFP28", "standard": "25GBASE-LR", "wavelength_nm": 1310,
     "dom_supported": True, "thresholds": _LR_THRESHOLDS, "threshold_source": _THRESH_SRC},
]

# Simulation-only physical parameters (assumptions, shown in limitations where used).
FIBER_ATTENUATION_DB_PER_KM = {_OM4: 3.0, _OS2: 0.4}
MATED_PAIR_LOSS_DB = 0.3  # assumed typical loss per mated connector pair at a patch panel
RX_LOS_DBM = -17.0  # simulated receiver loss-of-signal point (not a DOM threshold)

# Baseline transmitter / module readings (simulation fixture).
OPTIC_BASELINE = {
    "srv-a:eth0": {"tx_power_dbm": -1.8, "temperature_c": 41.2, "voltage_v": 3.30, "bias_ma": 6.8},
    "srv-b:eth0": {"tx_power_dbm": -2.0, "temperature_c": 43.5, "voltage_v": 3.29, "bias_ma": 7.1},
    "asw-1:Ethernet1/1": {"tx_power_dbm": -2.2, "temperature_c": 37.8, "voltage_v": 3.31, "bias_ma": 6.6},
    "asw-1:Ethernet1/49": {"tx_power_dbm": -0.9, "temperature_c": 39.4, "voltage_v": 3.30, "bias_ma": 34.2},
    "asw-2:Ethernet1/1": {"tx_power_dbm": -2.4, "temperature_c": 38.1, "voltage_v": 3.31, "bias_ma": 6.4},
    "asw-2:Ethernet1/49": {"tx_power_dbm": -1.1, "temperature_c": 40.0, "voltage_v": 3.30, "bias_ma": 33.8},
}

SERVER_DATA_IFACE = {"srv-a": "srv-a:eth0", "srv-b": "srv-b:eth0", "gw-1": "gw-1:xe-0/0/0"}
ENDPOINT_HOSTS = ["srv-a", "srv-b", "gw-1"]

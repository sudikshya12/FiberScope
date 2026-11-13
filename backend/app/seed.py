"""Repeatable, idempotent seed: inventory, scenario definitions, candidate profile placeholder.

Usage:  uv run python -m app.seed            # create/refresh seed data (keeps history)
        uv run python -m app.seed --check    # report what exists
Inventory rows are upserted by stable ID. Investigation history is never deleted by seeding.
"""
from __future__ import annotations

import argparse
import sys

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models as m
from .db import SessionLocal
from .domain import fixture as fx
from .scenarios import SCENARIOS


def _upsert(session: Session, _cls, _pk, /, **values):
    obj = session.get(_cls, _pk)
    if obj is None:
        obj = _cls(id=_pk, **values)
        session.add(obj)
    else:
        for k, v in values.items():
            setattr(obj, k, v)
    return obj


def seed(session: Session) -> dict[str, int]:
    _upsert(session, m.LabEnvironment, fx.ENVIRONMENT["id"], name=fx.ENVIRONMENT["name"], description=fx.ENVIRONMENT["description"])
    for v in fx.VLANS:
        _upsert(session, m.Vlan, v["id"], **{k: val for k, val in v.items() if k != "id"})
    session.flush()
    for d in fx.DEVICES:
        _upsert(session, m.Device, d["id"], environment_id=fx.ENVIRONMENT["id"], name=d["name"], role=d["role"], rack=d["rack"],
                rack_unit=d.get("rack_unit"), model=d["model"], is_passive=d.get("is_passive", False),
                is_modeled_only=d.get("is_modeled_only", False), mgmt_address=d.get("mgmt_address"), notes=d.get("notes", ""))
    session.flush()
    for idx, i in enumerate(fx.INTERFACES):
        iid = f"{i['device_id']}:{i['name']}"
        _upsert(session, m.Interface, iid, device_id=i["device_id"], name=i["name"], sort_key=idx, kind=i["kind"], media=i["media"],
                speed_gbps=i.get("speed_gbps"), mac=i.get("mac"), ipv4_cidr=i.get("ipv4_cidr"), ipv6_cidr=i.get("ipv6_cidr"),
                switchport_mode=i.get("switchport_mode"), intended_vlan=i.get("intended_vlan"),
                intended_allowed_vlans=i.get("intended_allowed_vlans"), intended_mtu=i.get("intended_mtu"),
                description=i.get("description", ""))
    session.flush()
    for pm in fx.PATCH_MAPPINGS:
        front, rear = f"{pm['panel']}:{pm['front']}", f"{pm['panel']}:{pm['rear']}"
        existing = session.scalars(select(m.PatchMapping).where(m.PatchMapping.front_interface_id == front)).first()
        if existing is None:
            session.add(m.PatchMapping(panel_device_id=pm["panel"], front_interface_id=front, rear_interface_id=rear))
    for c in fx.CABLES:
        obj = _upsert(session, m.CableSegment, c["id"], kind=c["kind"], trunk_id=c.get("trunk_id"), media=c["media"],
                      fiber_type=c.get("fiber_type"), connector_a=c["connector_a"], connector_b=c["connector_b"],
                      nominal_length_m=c.get("nominal_length_m"), label_status=c["label_status"], is_modeled_only=True,
                      notes=c.get("notes", ""), source="documented inventory (seed fixture)")
        session.flush()
        have = {e.end: e for e in obj.endpoints}
        for end, iid in (("A", c["a"]), ("B", c["b"])):
            if end in have:
                have[end].interface_id = iid
            else:
                obj.endpoints.append(m.CableEndpoint(end=end, interface_id=iid))
    for o in fx.OPTICS:
        _upsert(session, m.Optic, o["id"], interface_id=o["interface"], vendor=o["vendor"], part_number=o["part_number"],
                serial=o["serial"], form_factor=o["form_factor"], standard=o["standard"], wavelength_nm=o["wavelength_nm"],
                dom_supported=o["dom_supported"], thresholds=o["thresholds"], threshold_source=o["threshold_source"])
    for s in SCENARIOS.values():
        _upsert(session, m.ScenarioDefinition, s.id, key=s.key, version=s.version, title=s.definition["title"], definition=s.definition)
    if session.get(m.CandidateProfile, 1) is None:
        session.add(m.CandidateProfile(
            id=1, name="Your Name", target_role="Data Center Operations Technician",
            summary="Edit this in Settings → Candidate profile. Describe your own background here — FiberScope never invents experience.",
            links=[],
        ))
    session.commit()
    return {
        "devices": len(fx.DEVICES), "interfaces": len(fx.INTERFACES), "cables": len(fx.CABLES),
        "optics": len(fx.OPTICS), "scenarios": len(SCENARIOS),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="only report counts")
    args = ap.parse_args(argv)
    with SessionLocal() as session:
        if args.check:
            for model in (m.Device, m.Interface, m.CableSegment, m.Optic, m.ScenarioDefinition, m.Investigation, m.EvidenceItem):
                print(f"{model.__tablename__:<24} {len(session.scalars(select(model)).all())}")
            return 0
        print("seeded:", seed(session))
    return 0


if __name__ == "__main__":
    sys.exit(main())

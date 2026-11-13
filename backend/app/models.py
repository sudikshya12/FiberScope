"""SQLAlchemy ORM models.

Conventions
-----------
* Stable string IDs for inventory (``srv-a``, ``asw-1:Ethernet1/1``, ``CBL-F101``).
* All timestamps are timezone-aware UTC.
* Units are explicit in column names (``_dbm``, ``_m``, ``_c``, ``_ms``).
* Evidence rows are append-only: an ORM guard rejects updates/deletes.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    event,
)
from sqlalchemy.types import TypeDecorator
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class UTCDateTime(TypeDecorator):
    """DateTime that always round-trips as tz-aware UTC (SQLite drops tzinfo)."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None:
            if value.tzinfo is None:
                value = value.replace(tzinfo=UTC)
            value = value.astimezone(UTC).replace(tzinfo=None)
        return value

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value


# --------------------------------------------------------------------------- inventory


class LabEnvironment(Base):
    __tablename__ = "lab_environments"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class Device(Base):
    __tablename__ = "devices"
    __table_args__ = (
        CheckConstraint("role in ('server','access_switch','patch_panel','gateway')", name="ck_device_role"),
    )
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    environment_id: Mapped[str] = mapped_column(ForeignKey("lab_environments.id"))
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(32))
    rack: Mapped[str] = mapped_column(String(32))
    rack_unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    model: Mapped[str] = mapped_column(String(120))
    is_passive: Mapped[bool] = mapped_column(Boolean, default=False)
    is_modeled_only: Mapped[bool] = mapped_column(Boolean, default=False)
    mgmt_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")

    interfaces: Mapped[list[Interface]] = relationship(back_populates="device", order_by="Interface.sort_key")


class Vlan(Base):
    __tablename__ = "vlans"
    __table_args__ = (CheckConstraint("id between 1 and 4094", name="ck_vlan_range"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    ipv4_subnet: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ipv6_subnet: Mapped[str | None] = mapped_column(String(64), nullable=True)
    gateway_ipv4: Mapped[str | None] = mapped_column(String(64), nullable=True)
    description: Mapped[str] = mapped_column(Text, default="")


class Interface(Base):
    __tablename__ = "interfaces"
    __table_args__ = (
        UniqueConstraint("device_id", "name", name="uq_interface_device_name"),
        CheckConstraint(
            "kind in ('data','mgmt','uplink','routed','patch_front','patch_rear')", name="ck_interface_kind"
        ),
        CheckConstraint("intended_mtu is null or intended_mtu between 576 and 9216", name="ck_interface_mtu"),
    )
    id: Mapped[str] = mapped_column(String(96), primary_key=True)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id"))
    name: Mapped[str] = mapped_column(String(64))
    sort_key: Mapped[int] = mapped_column(Integer, default=0)
    kind: Mapped[str] = mapped_column(String(16))
    media: Mapped[str] = mapped_column(String(16))  # fiber | copper | none
    speed_gbps: Mapped[float | None] = mapped_column(Float, nullable=True)
    mac: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ipv4_cidr: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ipv6_cidr: Mapped[str | None] = mapped_column(String(64), nullable=True)
    switchport_mode: Mapped[str | None] = mapped_column(String(16), nullable=True)  # access | trunk | routed
    intended_vlan: Mapped[int | None] = mapped_column(ForeignKey("vlans.id"), nullable=True)
    intended_allowed_vlans: Mapped[list[int] | None] = mapped_column(JSON, nullable=True)
    intended_mtu: Mapped[int | None] = mapped_column(Integer, nullable=True)
    description: Mapped[str] = mapped_column(Text, default="")

    device: Mapped[Device] = relationship(back_populates="interfaces")
    optic: Mapped[Optic | None] = relationship(back_populates="interface", uselist=False)


class Optic(Base):
    """A pluggable transceiver. DOM support and thresholds are *per optic* (never universal)."""

    __tablename__ = "optics"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    interface_id: Mapped[str] = mapped_column(ForeignKey("interfaces.id"), unique=True)
    vendor: Mapped[str] = mapped_column(String(64))
    part_number: Mapped[str] = mapped_column(String(64))
    serial: Mapped[str] = mapped_column(String(64))
    form_factor: Mapped[str] = mapped_column(String(32))
    standard: Mapped[str] = mapped_column(String(64))
    wavelength_nm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dom_supported: Mapped[bool] = mapped_column(Boolean, default=False)
    # {"rx_power_dbm": {"low_alarm":..,"low_warning":..,"high_warning":..,"high_alarm":..}, ...}
    # Missing keys / null values mean "unknown" — never substitute defaults.
    thresholds: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    threshold_source: Mapped[str] = mapped_column(String(160), default="unavailable")

    interface: Mapped[Interface] = relationship(back_populates="optic")


class CableSegment(Base):
    __tablename__ = "cable_segments"
    __table_args__ = (
        CheckConstraint("media in ('fiber','copper','dac')", name="ck_cable_media"),
        CheckConstraint("label_status in ('labeled','missing','mismatch')", name="ck_cable_label"),
        CheckConstraint("nominal_length_m is null or nominal_length_m > 0", name="ck_cable_length"),
    )
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))  # patch | trunk_pair | direct
    trunk_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    media: Mapped[str] = mapped_column(String(16))
    fiber_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    connector_a: Mapped[str] = mapped_column(String(64))
    connector_b: Mapped[str] = mapped_column(String(64))
    nominal_length_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    label_status: Mapped[str] = mapped_column(String(16), default="labeled")
    is_modeled_only: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(120), default="documented inventory (seed fixture)")

    endpoints: Mapped[list[CableEndpoint]] = relationship(
        back_populates="cable", cascade="all, delete-orphan", order_by="CableEndpoint.end"
    )


class CableEndpoint(Base):
    """One end of a cable. ``interface_id`` is UNIQUE: a port can hold at most one cable end."""

    __tablename__ = "cable_endpoints"
    __table_args__ = (
        UniqueConstraint("cable_id", "end", name="uq_cable_end"),
        CheckConstraint("end in ('A','B')", name="ck_cable_end"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cable_id: Mapped[str] = mapped_column(ForeignKey("cable_segments.id", ondelete="CASCADE"))
    end: Mapped[str] = mapped_column(String(1))
    interface_id: Mapped[str] = mapped_column(ForeignKey("interfaces.id"), unique=True)

    cable: Mapped[CableSegment] = relationship(back_populates="endpoints")


class PatchMapping(Base):
    """Passive front↔rear mapping inside a patch panel. Not an IP device; no forwarding logic."""

    __tablename__ = "patch_mappings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    panel_device_id: Mapped[str] = mapped_column(ForeignKey("devices.id"))
    front_interface_id: Mapped[str] = mapped_column(ForeignKey("interfaces.id"), unique=True)
    rear_interface_id: Mapped[str] = mapped_column(ForeignKey("interfaces.id"), unique=True)


# --------------------------------------------------------------------------- scenarios


class ScenarioDefinition(Base):
    __tablename__ = "scenario_definitions"
    __table_args__ = (UniqueConstraint("key", "version", name="uq_scenario_key_version"),)
    id: Mapped[str] = mapped_column(String(80), primary_key=True)  # f"{key}@{version}"
    key: Mapped[str] = mapped_column(String(64))
    version: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(160))
    definition: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class ScenarioExecution(Base):
    __tablename__ = "scenario_executions"
    __table_args__ = (
        CheckConstraint("source_mode in ('SIMULATED','LINUX_LAB')", name="ck_exec_source"),
        CheckConstraint("status in ('baseline','faulted','reset')", name="ck_exec_status"),
    )
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    scenario_definition_id: Mapped[str] = mapped_column(ForeignKey("scenario_definitions.id"))
    source_mode: Mapped[str] = mapped_column(String(16), default="SIMULATED")
    status: Mapped[str] = mapped_column(String(16), default="baseline")
    seed: Mapped[int] = mapped_column(Integer)
    state: Mapped[dict[str, Any]] = mapped_column(JSON)  # backend-owned; never sent to clients
    sim_clock_ms: Mapped[int] = mapped_column(Integer, default=0)
    run_counter: Mapped[int] = mapped_column(Integer, default=0)
    fault_injected_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    fault_injected_sim_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, onupdate=utcnow)

    scenario: Mapped[ScenarioDefinition] = relationship()


# --------------------------------------------------------------------------- investigations

INVESTIGATION_STATUSES = (
    "opened",
    "baseline_reviewed",
    "investigating",
    "diagnosis_recorded",
    "repair_applied",
    "verifying",
    "verification_failed",
    "resolved",
    "abandoned",
)


class Investigation(Base):
    __tablename__ = "investigations"
    __table_args__ = (
        CheckConstraint("mode in ('guided','challenge')", name="ck_inv_mode"),
        CheckConstraint(
            "status in (" + ",".join(f"'{s}'" for s in INVESTIGATION_STATUSES) + ")", name="ck_inv_status"
        ),
    )
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    execution_id: Mapped[str] = mapped_column(ForeignKey("scenario_executions.id"), unique=True)
    mode: Mapped[str] = mapped_column(String(16), default="guided")
    status: Mapped[str] = mapped_column(String(32), default="opened")
    symptom: Mapped[str] = mapped_column(Text, default="")
    scope: Mapped[str] = mapped_column(Text, default="")
    diagnosis_category: Mapped[str | None] = mapped_column(String(48), nullable=True)
    diagnosis: Mapped[str | None] = mapped_column(Text, nullable=True)
    diagnosis_evidence_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    lessons_learned: Mapped[str] = mapped_column(Text, default="")
    failed_verifications: Mapped[int] = mapped_column(Integer, default=0)
    reopen_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    baseline_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    first_action_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    diagnosis_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    repair_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    abandoned_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)

    execution: Mapped[ScenarioExecution] = relationship()


class DiagnosticRun(Base):
    __tablename__ = "diagnostic_runs"
    __table_args__ = (
        CheckConstraint("phase in ('baseline','investigation','verification','repair')", name="ck_run_phase"),
    )
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    investigation_id: Mapped[str] = mapped_column(ForeignKey("investigations.id"))
    execution_id: Mapped[str] = mapped_column(ForeignKey("scenario_executions.id"))
    action: Mapped[str] = mapped_column(String(48))
    target: Mapped[dict[str, Any]] = mapped_column(JSON)
    params: Mapped[dict[str, Any]] = mapped_column(JSON)
    phase: Mapped[str] = mapped_column(String(16))
    source_mode: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16))  # completed | error
    started_at: Mapped[datetime] = mapped_column(UTCDateTime())
    completed_at: Mapped[datetime] = mapped_column(UTCDateTime())
    sim_started_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sim_duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)


class EvidenceItem(Base):
    """Immutable evidence record. Never updated after insert; new observations create new rows."""

    __tablename__ = "evidence_items"
    __table_args__ = (
        CheckConstraint(
            "source_mode in ('SIMULATED','LINUX_LAB','IMPORTED_SAMPLE')", name="ck_evidence_source_mode"
        ),
        CheckConstraint("collection_status in ('completed','error','partial')", name="ck_evidence_status"),
    )
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    seq: Mapped[int] = mapped_column(Integer)
    investigation_id: Mapped[str | None] = mapped_column(ForeignKey("investigations.id"), nullable=True)
    execution_id: Mapped[str | None] = mapped_column(ForeignKey("scenario_executions.id"), nullable=True)
    diagnostic_run_id: Mapped[str | None] = mapped_column(ForeignKey("diagnostic_runs.id"), nullable=True)
    phase: Mapped[str] = mapped_column(String(16))
    source_mode: Mapped[str] = mapped_column(String(16))
    source_id: Mapped[str] = mapped_column(String(120))
    collector: Mapped[str] = mapped_column(String(48))
    title: Mapped[str] = mapped_column(String(200))
    target: Mapped[dict[str, Any]] = mapped_column(JSON)
    params: Mapped[dict[str, Any]] = mapped_column(JSON)
    command: Mapped[str] = mapped_column(Text)
    purpose: Mapped[str] = mapped_column(Text)
    raw_output: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    interpretation: Mapped[str] = mapped_column(Text)
    limitations: Mapped[list[str]] = mapped_column(JSON)
    observations: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    verdict: Mapped[str] = mapped_column(String(16))  # ok | warning | fail | info
    collection_status: Mapped[str] = mapped_column(String(16))
    collected_at: Mapped[datetime] = mapped_column(UTCDateTime())
    sim_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    content_sha256: Mapped[str] = mapped_column(String(64))


@event.listens_for(EvidenceItem, "before_update")
def _evidence_is_immutable(_mapper, _conn, target):  # pragma: no cover - exercised by tests
    raise PermissionError(f"Evidence {target.id} is immutable; record a new observation instead.")


@event.listens_for(EvidenceItem, "before_delete")
def _evidence_not_deletable(_mapper, _conn, target):  # pragma: no cover - exercised by tests
    raise PermissionError(f"Evidence {target.id} cannot be deleted.")


class OpticalObservation(Base):
    """Normalized optical reading extracted from an evidence item. Null = not reported (never zero)."""

    __tablename__ = "optical_observations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    interface_id: Mapped[str] = mapped_column(ForeignKey("interfaces.id"))
    evidence_id: Mapped[str | None] = mapped_column(ForeignKey("evidence_items.id"), nullable=True)
    investigation_id: Mapped[str | None] = mapped_column(ForeignKey("investigations.id"), nullable=True)
    source_mode: Mapped[str] = mapped_column(String(16))
    observed_at: Mapped[datetime] = mapped_column(UTCDateTime())
    sim_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tx_power_dbm: Mapped[float | None] = mapped_column(Float, nullable=True)
    rx_power_dbm: Mapped[float | None] = mapped_column(Float, nullable=True)
    temperature_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    voltage_v: Mapped[float | None] = mapped_column(Float, nullable=True)
    bias_ma: Mapped[float | None] = mapped_column(Float, nullable=True)
    flags: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    raw: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class Hypothesis(Base):
    __tablename__ = "hypotheses"
    __table_args__ = (
        CheckConstraint("status in ('open','supported','refuted','confirmed')", name="ck_hyp_status"),
    )
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    investigation_id: Mapped[str] = mapped_column(ForeignKey("investigations.id"))
    statement: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="open")
    supporting_evidence_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    contradicting_evidence_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, onupdate=utcnow)


class RepairAction(Base):
    __tablename__ = "repair_actions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    investigation_id: Mapped[str] = mapped_column(ForeignKey("investigations.id"))
    execution_id: Mapped[str] = mapped_column(ForeignKey("scenario_executions.id"))
    action: Mapped[str] = mapped_column(String(48))
    target: Mapped[dict[str, Any]] = mapped_column(JSON)
    params: Mapped[dict[str, Any]] = mapped_column(JSON)
    description: Mapped[str] = mapped_column(Text)
    command: Mapped[str] = mapped_column(Text)
    source_mode: Mapped[str] = mapped_column(String(16))
    changed_resources: Mapped[list[str]] = mapped_column(JSON, default=list)
    outcome: Mapped[str] = mapped_column(String(24))  # state_changed | no_change
    notes: Mapped[str] = mapped_column(Text, default="")
    evidence_id: Mapped[str | None] = mapped_column(ForeignKey("evidence_items.id"), nullable=True)
    applied_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    sim_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)


class VerificationRun(Base):
    __tablename__ = "verification_runs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    investigation_id: Mapped[str] = mapped_column(ForeignKey("investigations.id"))
    started_at: Mapped[datetime] = mapped_column(UTCDateTime())
    completed_at: Mapped[datetime] = mapped_column(UTCDateTime())
    passed: Mapped[bool] = mapped_column(Boolean)
    checks: Mapped[list[dict[str, Any]]] = mapped_column(JSON)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    investigation_id: Mapped[str | None] = mapped_column(ForeignKey("investigations.id"), nullable=True)
    execution_id: Mapped[str | None] = mapped_column(ForeignKey("scenario_executions.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(48))
    message: Mapped[str] = mapped_column(Text)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    sim_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)


class CandidateProfile(Base):
    """Editable portfolio details. Defaults are placeholders, never invented experience."""

    __tablename__ = "candidate_profile"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    name: Mapped[str] = mapped_column(String(120), default="Your Name")
    target_role: Mapped[str] = mapped_column(String(160), default="Data Center Operations Technician")
    summary: Mapped[str] = mapped_column(Text, default="")
    links: Mapped[list[dict[str, str]]] = mapped_column(JSON, default=list)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, onupdate=utcnow)


class Counter(Base):
    """Monotonic counters for readable IDs (INV-0001, EV-00001)."""

    __tablename__ = "counters"
    name: Mapped[str] = mapped_column(String(32), primary_key=True)
    value: Mapped[int] = mapped_column(Integer, default=0)

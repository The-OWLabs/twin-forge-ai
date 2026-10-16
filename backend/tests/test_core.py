"""Tests for core interfaces, units, event bus, and DI container."""
import pytest
from backend.core.models.units import VibrationMmS, TemperatureCelsius
from backend.core.events.bus import InMemoryEventBus, DomainEvent
from backend.core.di.container import Container


@pytest.mark.asyncio
async def test_units_validation():
    vib = VibrationMmS(value=2.4)
    assert vib.value == 2.4
    temp = TemperatureCelsius(value=65.0)
    assert temp.value == 65.0

    with pytest.raises(Exception):
        VibrationMmS(value=-1.0)  # ge=0.0 constraint


@pytest.mark.asyncio
async def test_event_bus():
    bus = InMemoryEventBus()
    received = []

    async def on_vibration(event: DomainEvent):
        received.append(event.payload["rms"])

    bus.subscribe("VIBRATION_SPIKE", on_vibration)
    await bus.publish(DomainEvent(event_type="VIBRATION_SPIKE", payload={"rms": 5.8}))

    assert len(received) == 1
    assert received[0] == 5.8


def test_di_container():
    c = Container()
    c.register_singleton(str, "singleton_value")
    assert c.resolve(str) == "singleton_value"

"""The sample plant: one round through a water-works pump house.

Positions are in the round schematic's coordinate space (1200 x 640), drawn by web/components/Schematic.
`pair` links two gauges across a piece of equipment so the agent can check the pressure drop.
`drift_per_day` is how fast a reading may move over a week before it's worth a work order.
"""

SITE = "Riverside Water Works"

ROUND = {
    "id": "pump-house",
    "name": "High-lift pump house",
    "site": SITE,
    "shift": "Morning round",
    "gauges": ["PI-101", "PI-102", "TI-201", "PI-103", "PI-104", "PI-105", "PI-106", "PI-107"],
}

GAUGES = [
    {
        "id": "PI-101", "name": "Intake header", "service": "Raw water suction to the high-lift pumps",
        "unit": "bar", "min": 0, "max": 6, "normal": [1.2, 2.4], "alarm": {"low": 0.8, "high": None},
        "drift_per_day": 0.15, "pos": [200, 300],
    },
    {
        "id": "PI-102", "name": "Pump P-1 discharge", "service": "High-lift pump P-1, duty",
        "unit": "bar", "min": 0, "max": 16, "normal": [7.0, 9.5], "alarm": {"low": 5.0, "high": 12.0},
        "drift_per_day": 0.35, "pos": [520, 220],
    },
    {
        "id": "TI-201", "name": "Pump P-1 bearing", "service": "Drive-end bearing temperature, P-1",
        "unit": "°C", "min": 0, "max": 120, "normal": [30, 70], "alarm": {"low": None, "high": 85},
        "drift_per_day": 2.0, "pos": [300, 150],
    },
    {
        "id": "PI-103", "name": "Pump P-2 discharge", "service": "High-lift pump P-2, standby",
        "unit": "bar", "min": 0, "max": 16, "normal": [0.0, 9.5], "alarm": {"low": None, "high": 12.0},
        "drift_per_day": 0.35, "pos": [520, 540],
    },
    {
        "id": "PI-104", "name": "Filter F-1 inlet", "service": "Pressure filter F-1, upstream",
        "unit": "bar", "min": 0, "max": 10, "normal": [5.5, 8.0], "alarm": {"low": 4.0, "high": 9.0},
        "drift_per_day": 0.3, "pos": [680, 300],
        "pair": {"with": "PI-105", "role": "inlet", "across": "filter F-1", "dp_limit": 1.2},
    },
    {
        "id": "PI-105", "name": "Filter F-1 outlet", "service": "Pressure filter F-1, downstream",
        "unit": "bar", "min": 0, "max": 10, "normal": [4.5, 7.5], "alarm": {"low": 3.5, "high": 9.0},
        "drift_per_day": 0.3, "pos": [920, 300],
        "pair": {"with": "PI-104", "role": "outlet", "across": "filter F-1", "dp_limit": 1.2},
    },
    {
        "id": "PI-106", "name": "Air receiver", "service": "Instrument air receiver, compressor C-1",
        "unit": "psi", "min": 0, "max": 160, "normal": [90, 125], "alarm": {"low": 80, "high": 140},
        "drift_per_day": 6, "pos": [760, 520],
    },
    {
        "id": "PI-107", "name": "Treated water main", "service": "Distribution main leaving the works",
        "unit": "bar", "min": 0, "max": 10, "normal": [3.5, 5.5], "alarm": {"low": 2.5, "high": 7.0},
        "drift_per_day": 0.25, "pos": [1090, 300],
    },
]

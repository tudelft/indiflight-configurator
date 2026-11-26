// Display units of the Flight Plan tab. Waypoints are stored in feet / knots
// (useFlightPlan.js, saved plans); these convert for display and entry only.

export const FLIGHT_PLAN_UNITS = {
    IMPERIAL: "imperial", // ft, knots, nautical miles
    METRIC: "metric", // m, m/s, km
};

const FEET_TO_METERS = 0.3048;
const KNOTS_TO_MPS = 1852 / 3600;
const METERS_TO_NAUTICAL_MILES = 1 / 1852;

const isMetric = (units) => units === FLIGHT_PLAN_UNITS.METRIC;
const round = (value, decimals) => {
    const f = 10 ** decimals;
    return Math.round(value * f) / f;
};

// Altitude: feet <-> display unit (m with 0.1 m, ft with 1 ft resolution)
export const altitudeToDisplay = (feet, units) => (isMetric(units) ? round(feet * FEET_TO_METERS, 1) : round(feet, 0));
export const altitudeFromDisplay = (value, units) => (isMetric(units) ? value / FEET_TO_METERS : value);
export const altitudeUnit = (units) => (isMetric(units) ? "m" : "ft");

// Speed: knots <-> display unit (0.1 resolution)
export const speedToDisplay = (knots, units) => round(isMetric(units) ? knots * KNOTS_TO_MPS : knots, 1);
export const speedFromDisplay = (value, units) => (isMetric(units) ? value / KNOTS_TO_MPS : value);
export const speedUnit = (units) => (isMetric(units) ? "m/s" : "kts");

// Distance: meters -> display string
export const formatDistance = (meters, units) => {
    if (isMetric(units)) {
        return meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(2)}km`;
    }
    return `${(meters * METERS_TO_NAUTICAL_MILES).toFixed(2)}nm`;
};

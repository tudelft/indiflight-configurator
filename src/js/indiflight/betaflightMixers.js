// Kept apart from flightPlotterCrafts.js, which imports the flightplotter library, so the INDI tab can use the
// table without pulling uPlot into the tab registry.

/**
 * Betaflight mixer tables (mixer_init.c): per motor [azimuth in deg clockwise from the nose, spin with props in,
 * level: 0 flat, -1 top / 1 bottom of a coaxial pair].
 */
export const BETAFLIGHT_MIXERS = [
    {
        id: "quadx",
        name: "Quad X",
        rotors: [
            [135, "cw"],
            [45, "ccw"],
            [225, "ccw"],
            [315, "cw"],
        ],
    },
    {
        id: "hex6x",
        name: "Hex X",
        rotors: [
            [150, "ccw"],
            [30, "ccw"],
            [210, "cw"],
            [330, "cw"],
            [90, "cw"],
            [270, "ccw"],
        ],
    },
    {
        id: "hex6p",
        name: "Hex + (HEX6)",
        rotors: [
            [120, "ccw"],
            [60, "cw"],
            [240, "ccw"],
            [300, "cw"],
            [0, "ccw"],
            [180, "cw"],
        ],
    },
    {
        id: "octoflatx",
        name: "Octo flat X",
        rotors: [
            [292.5, "ccw"],
            [22.5, "ccw"],
            [112.5, "ccw"],
            [202.5, "ccw"],
            [337.5, "cw"],
            [67.5, "cw"],
            [157.5, "cw"],
            [247.5, "cw"],
        ],
    },
    {
        id: "octox8",
        name: "Octo X8 (coaxial)",
        rotors: [
            [135, "cw", -1],
            [45, "ccw", -1],
            [225, "ccw", -1],
            [315, "cw", -1],
            [135, "ccw", 1],
            [45, "cw", 1],
            [225, "cw", 1],
            [315, "ccw", 1],
        ],
    },
];

/** @param {"cw"|"ccw"} spin */
export const flipSpin = (spin) => ({ cw: "ccw", ccw: "cw" })[spin];

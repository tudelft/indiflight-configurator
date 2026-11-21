// A Flight Plotter tab in its own window. The opener holds the log; this page attaches to it (attachPopout).
import "flightplotter/style.css";
import "uplot/dist/uPlot.min.css";
import { attachPopout } from "flightplotter";

attachPopout(document.getElementById("plotter"));

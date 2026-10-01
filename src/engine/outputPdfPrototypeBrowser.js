import { registerStdFonts } from "pdfkit";
import Helvetica from "pdfkit/standard-fonts/Helvetica";
import HelveticaBold from "pdfkit/standard-fonts/HelveticaBold";
import { generateExperimentalPdf } from "./outputPdfPrototype.js";

registerStdFonts(Helvetica, HelveticaBold);
export { generateExperimentalPdf };

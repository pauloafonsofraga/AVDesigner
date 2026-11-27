import { registerStdFonts } from "pdfkit";
import Helvetica from "pdfkit/standard-fonts/Helvetica";
import HelveticaBold from "pdfkit/standard-fonts/HelveticaBold";
import regular from "../../assets/fonts/Cabin-Regular.ttf";
import bold from "../../assets/fonts/Cabin-Bold.ttf";
import { generatePdf as renderPdf } from "./outputPdf.js";

registerStdFonts(Helvetica, HelveticaBold);
export const generatePdf = options => renderPdf({ ...options, fonts: [regular, bold] });

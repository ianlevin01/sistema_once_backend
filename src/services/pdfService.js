import puppeteer from "puppeteer";

/**
 * Genera un PDF a partir de HTML usando Puppeteer (Chrome headless).
 * Devuelve un Buffer con el PDF listo para enviar como response.
 */
export async function generatePdfFromHtml(html) {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  try {
    const page = await browser.newPage();

    // Cargar el HTML completo (con <head>/<style> incluidos)
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    // Pequeña pausa para que los estilos se apliquen correctamente
    await new Promise((r) => setTimeout(r, 200));

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "1cm", right: "1cm", bottom: "1cm", left: "1cm" },
    });

    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

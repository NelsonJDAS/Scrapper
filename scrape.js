const puppeteer = require("puppeteer");
const axios = require("axios");

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox"],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
  );

  const urls = [
    // Caracas
    "https://listado.mercadolibre.com.ve/inmuebles/distrito-capital/apartamento-caracas_PriceRange_30000USD-95000USD_PublishedToday_YES_BEDROOMS_3-*_NoIndex_True",
    "https://listado.mercadolibre.com.ve/inmuebles/distrito-capital/apartamento-caracas_Desde_49_PriceRange_30000USD-95000USD_PublishedToday_YES_BEDROOMS_3-*_NoIndex_True",
    "https://listado.mercadolibre.com.ve/inmuebles/distrito-capital/apartamento-caracas_Desde_97_PriceRange_30000USD-95000USD_PublishedToday_YES_BEDROOMS_3-*_NoIndex_True",

    // Valencia
    "https://listado.mercadolibre.com.ve/inmuebles/carabobo/apartamento-valencia_PriceRange_30000USD-95000USD_PublishedToday_YES_BEDROOMS_3-*_NoIndex_True",
    "https://listado.mercadolibre.com.ve/inmuebles/carabobo/apartamento-valencia_Desde_49_PriceRange_30000USD-95000USD_PublishedToday_YES_BEDROOMS_3-*_NoIndex_True",
    "https://listado.mercadolibre.com.ve/inmuebles/carabobo/apartamento-valencia_Desde_97_PriceRange_30000USD-95000USD_PublishedToday_YES_BEDROOMS_3-*_NoIndex_True"
  ];

  let allResults = [];

  for (const url of urls) {
    console.log("Scrapeando:", url);
    await page.goto(url, { waitUntil: "domcontentloaded" });

    // ✅ Verificar si la página no tiene resultados
    const noResults = await page.evaluate(() => {
      return !!document.querySelector(".ui-search-null-results__title");
    });

    if (noResults) {
      console.log("Página vacía (sin resultados), saltando...");
      continue; // pasa a la siguiente URL
    }

    // ✅ Esperar los items con timeout reducido
    try {
      await page.waitForSelector(".ui-search-layout__item", { timeout: 5000 });
    } catch {
      console.log("No se cargaron items, saltando...");
      continue;
    }

    // Extraer datos
    const data = await page.evaluate(() => {
      const items = document.querySelectorAll(".ui-search-layout__item");
      return [...items].map(el => {
        const title = el.querySelector(".poly-component__title")?.innerText?.trim();
        const price = el.querySelector(".andes-money-amount__fraction")?.innerText?.trim();
        const location = el.querySelector(".poly-component__location")?.innerText?.trim();
        const link = el.querySelector("a.poly-component__title")?.href;

        // 🎯 Extraer imagen robustamente
        let img = null;
        const specificImg = el.querySelector("img.ui-search-result-image__element");
        if (specificImg?.src) {
          img = specificImg.src;
        } else {
          const allImgs = el.querySelectorAll("img");
          for (const i of allImgs) {
            const src = i.src || "";
            if (src.includes("mlstatic.com")) {
              img = src;
              break;
            }
          }
        }

        // 📌 Extraer habitaciones, baños y área
        let rooms = null, bathrooms = null, area = null;
        const possibleAttributes = el.querySelectorAll("li, span");
        possibleAttributes.forEach(attr => {
          const text = attr.innerText?.toLowerCase();
          if (!text) return;
          if (text.includes("hab") || text.includes("dorm")) rooms = text.trim();
          else if (text.includes("baño")) bathrooms = text.trim();
          else if (text.includes("m²")) area = text.trim();
        });

        return { title, price, location, link, img, rooms, bathrooms, area };
      });
    });

    allResults = allResults.concat(data);
    console.log("Resultados extraídos de esta página:", data.length);
  }

  await browser.close();
  console.log("TOTAL resultados:", allResults.length);

  // Enviar datos a n8n
  try {
    await axios.post(
      "http://localhost:5678/webhook/mercadolibre",
      { results: allResults }
    );
    console.log("Datos enviados a n8n ✅");
  } catch (error) {
    console.error("Error enviando a n8n:", error.response?.status, error.message);
  }
})();
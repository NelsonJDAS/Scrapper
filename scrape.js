const puppeteer = require("puppeteer");
const axios = require("axios");

// Función sleep para cualquier versión de Puppeteer
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Función para hacer scroll hasta el final de la página
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false, // ayuda a que no bloquee MercadoLibre
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled"
    ]
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
  );

  // Anti-detección Puppeteer
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

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
  const seenSignatures = new Set();

  // Genera la firma semántica para evitar duplicados
  const generateSignature = (item) => {
    const priceNum = parseInt(item.price?.replace(/\D/g, "") || "0");
    const roundedPrice = Math.round(priceNum / 1000);
    const titleShort = item.title?.toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 20) || "";
    const locationShort = item.location?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
    const area = item.area || "";
    const rooms = item.rooms || "";
    return `${titleShort}-${roundedPrice}-${locationShort}-${area}-${rooms}`;
  };

  for (const url of urls) {
    console.log("Scrapeando:", url);

    await page.goto(url, { waitUntil: "networkidle2" });
    await sleep(3000); // espera extra
    await autoScroll(page);

    const noResults = await page.evaluate(() => {
      return !!document.querySelector(".ui-search-null-results__title");
    });

    if (noResults) {
      console.log("Página vacía (sin resultados), saltando...");
      continue;
    }

    try {
      await page.waitForSelector(".ui-search-layout__item", { timeout: 30000 }); // 30s para entornos lentos
    } catch {
      console.log("No se cargaron items, saltando...");
      continue;
    }

    const data = await page.evaluate(() => {
      const items = document.querySelectorAll(".ui-search-layout__item");
      return [...items].map(el => {
        const title = el.querySelector(".poly-component__title")?.innerText?.trim();
        const price = el.querySelector(".andes-money-amount__fraction")?.innerText?.trim();
        const location = el.querySelector(".poly-component__location")?.innerText?.trim();
        const link = el.querySelector("a.poly-component__title")?.href;

        // Imagen robusta
        let img = null;
        const specificImg = el.querySelector("img.ui-search-result-image__element");
        if (specificImg?.src) img = specificImg.src;
        else {
          const allImgs = el.querySelectorAll("img");
          for (const i of allImgs) {
            const src = i.src || "";
            if (src.includes("mlstatic.com")) { img = src; break; }
          }
        }

        // Habitaciones, baños y área
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

    data.forEach(item => {
      const signature = generateSignature(item);
      if (!seenSignatures.has(signature)) {
        allResults.push(item);
        seenSignatures.add(signature);
      } else {
        console.log("Duplicado detectado y descartado:", item.title, item.location, item.price);
      }
    });

    console.log("Resultados únicos acumulados hasta ahora:", allResults.length);
  }

  await browser.close();
  console.log("TOTAL resultados únicos:", allResults.length);

  // Enviar datos a n8n
  try {
    await axios.post(
      process.env.N8N_WEBHOOK_URL,
      { results: allResults }
    );
    console.log("Datos enviados a n8n ✅");
  } catch (error) {
    console.error("Error enviando a n8n:", error.response?.status, error.message);
  }
})();




// const puppeteer = require("puppeteer");
// const axios = require("axios");

// (async () => {
//   const browser = await puppeteer.launch({
//     headless: true,
//     args: ["--no-sandbox", "--disable-setuid-sandbox"],
//   });

//   const page = await browser.newPage();
//   await page.setUserAgent(
//     "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
//   );

//   const urls = [
//     // Caracas
//     "https://listado.mercadolibre.com.ve/inmuebles/distrito-capital/apartamento-caracas_PriceRange_30000USD-95000USD_PublishedToday_YES_BEDROOMS_3-*_NoIndex_True",
//     "https://listado.mercadolibre.com.ve/inmuebles/distrito-capital/apartamento-caracas_Desde_49_PriceRange_30000USD-95000USD_PublishedToday_YES_BEDROOMS_3-*_NoIndex_True",
//     "https://listado.mercadolibre.com.ve/inmuebles/distrito-capital/apartamento-caracas_Desde_97_PriceRange_30000USD-95000USD_PublishedToday_YES_BEDROOMS_3-*_NoIndex_True",
//     // Valencia
//     "https://listado.mercadolibre.com.ve/inmuebles/carabobo/apartamento-valencia_PriceRange_30000USD-95000USD_PublishedToday_YES_BEDROOMS_3-*_NoIndex_True",
//     "https://listado.mercadolibre.com.ve/inmuebles/carabobo/apartamento-valencia_Desde_49_PriceRange_30000USD-95000USD_PublishedToday_YES_BEDROOMS_3-*_NoIndex_True",
//     "https://listado.mercadolibre.com.ve/inmuebles/carabobo/apartamento-valencia_Desde_97_PriceRange_30000USD-95000USD_PublishedToday_YES_BEDROOMS_3-*_NoIndex_True"
//   ];

//   let allResults = [];
//   const seenSignatures = new Set();

//   // Función para generar la firma semántica
//   const generateSignature = (item) => {
//     const priceNum = parseInt(item.price?.replace(/\D/g, "") || "0");
//     const roundedPrice = Math.round(priceNum / 1000); // agrupar por miles
//     const titleShort = item.title?.toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 20) || "";
//     const locationShort = item.location?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
//     const area = item.area || "";
//     const rooms = item.rooms || "";
//     return `${titleShort}-${roundedPrice}-${locationShort}-${area}-${rooms}`;
//   };

//   for (const url of urls) {
//     console.log("Scrapeando:", url);
//     await page.goto(url, { waitUntil: "domcontentloaded" });

//     const noResults = await page.evaluate(() => {
//       return !!document.querySelector(".ui-search-null-results__title");
//     });

//     if (noResults) {
//       console.log("Página vacía (sin resultados), saltando...");
//       continue;
//     }

//     try {
//       await page.waitForSelector(".ui-search-layout__item", { timeout: 5000 });
//     } catch {
//       console.log("No se cargaron items, saltando...");
//       continue;
//     }

//     const data = await page.evaluate(() => {
//       const items = document.querySelectorAll(".ui-search-layout__item");
//       return [...items].map(el => {
//         const title = el.querySelector(".poly-component__title")?.innerText?.trim();
//         const price = el.querySelector(".andes-money-amount__fraction")?.innerText?.trim();
//         const location = el.querySelector(".poly-component__location")?.innerText?.trim();
//         const link = el.querySelector("a.poly-component__title")?.href;

//         // Imagen robusta
//         let img = null;
//         const specificImg = el.querySelector("img.ui-search-result-image__element");
//         if (specificImg?.src) img = specificImg.src;
//         else {
//           const allImgs = el.querySelectorAll("img");
//           for (const i of allImgs) {
//             const src = i.src || "";
//             if (src.includes("mlstatic.com")) { img = src; break; }
//           }
//         }

//         // Habitaciones, baños y área
//         let rooms = null, bathrooms = null, area = null;
//         const possibleAttributes = el.querySelectorAll("li, span");
//         possibleAttributes.forEach(attr => {
//           const text = attr.innerText?.toLowerCase();
//           if (!text) return;
//           if (text.includes("hab") || text.includes("dorm")) rooms = text.trim();
//           else if (text.includes("baño")) bathrooms = text.trim();
//           else if (text.includes("m²")) area = text.trim();
//         });

//         return { title, price, location, link, img, rooms, bathrooms, area };
//       });
//     });

//     data.forEach(item => {
//       const signature = generateSignature(item);
//       if (!seenSignatures.has(signature)) {
//         allResults.push(item);
//         seenSignatures.add(signature);
//       } else {
//         console.log("Duplicado detectado y descartado:", item.title, item.location, item.price);
//       }
//     });

//     console.log("Resultados únicos acumulados hasta ahora:", allResults.length);
//   }

//   await browser.close();
//   console.log("TOTAL resultados únicos:", allResults.length);

//   // Enviar datos a n8n
//   try {
//     await axios.post(
//       "https://n8n-n8n.sjctlk.easypanel.host/webhook/mercadolibre",
//       { results: allResults }
//     );
//     console.log("Datos enviados a n8n ✅");
//   } catch (error) {
//     console.error("Error enviando a n8n:", error.response?.status, error.message);
//   }
// })();
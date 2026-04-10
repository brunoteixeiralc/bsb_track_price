import axios from "axios";

// Usa a API pública do exchangerate-api (sem autenticação, com limite generoso)
// Fallback: taxa hardcoded caso a API esteja fora
const FALLBACK_USD_BRL = 5.0;

let cachedRate: { rate: number; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

export async function getUSDtoBRL(): Promise<number> {
  if (cachedRate && Date.now() - cachedRate.fetchedAt < CACHE_TTL_MS) {
    return cachedRate.rate;
  }

  try {
    const response = await axios.get(
      "https://api.exchangerate-api.com/v4/latest/USD",
      { timeout: 5000 }
    );
    const rate: number = response.data.rates?.BRL;
    if (!rate) throw new Error("BRL rate not found");

    cachedRate = { rate, fetchedAt: Date.now() };
    console.log(`[currency] USD→BRL: ${rate}`);
    return rate;
  } catch (err) {
    console.warn(`[currency] Falha ao buscar taxa, usando fallback ${FALLBACK_USD_BRL}: ${err instanceof Error ? err.message : String(err)}`);
    return FALLBACK_USD_BRL;
  }
}

export async function convertToBRL(amount: number, currency: string): Promise<number> {
  if (currency === "BRL") return amount;

  if (currency === "USD") {
    const rate = await getUSDtoBRL();
    return Math.round(amount * rate * 100) / 100;
  }

  // Para outras moedas, busca a taxa via USD como intermediário
  try {
    const response = await axios.get(
      `https://api.exchangerate-api.com/v4/latest/${currency}`,
      { timeout: 5000 }
    );
    const rateToBRL: number = response.data.rates?.BRL;
    if (!rateToBRL) throw new Error(`BRL rate not found for ${currency}`);
    return Math.round(amount * rateToBRL * 100) / 100;
  } catch {
    // Fallback: converte para USD primeiro, depois BRL
    const usdRate: number = (await axios.get(
      `https://api.exchangerate-api.com/v4/latest/${currency}`
    ).catch(() => ({ data: { rates: { USD: 1 / FALLBACK_USD_BRL } } }))).data.rates?.USD ?? 1;

    const brlRate = await getUSDtoBRL();
    return Math.round(amount * usdRate * brlRate * 100) / 100;
  }
}

export function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

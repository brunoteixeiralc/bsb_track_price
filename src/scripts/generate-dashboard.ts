import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { getFullHistory } from "../services/history";
import { HistoryEntry } from "../types";

dotenv.config();

/**
 * Script para gerar o Dashboard estático (HTML + JS)
 * Lê os dados do Turso e injeta no template.
 */
async function generate() {
  console.log("[dashboard] Buscando dados do histórico...");
  const history = await getFullHistory();
  
  if (history.length === 0) {
    console.warn("[dashboard] Nenhum dado encontrado no histórico para gerar o dashboard.");
  }

  const outputDir = path.join(process.cwd(), "dist-pages");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const html = template(history);
  fs.writeFileSync(path.join(outputDir, "index.html"), html);
  console.log(`[dashboard] Dashboard gerado com sucesso em: ${path.join(outputDir, "index.html")}`);
  process.exit(0);
}

function template(history: HistoryEntry[]): string {
  // Prepara os dados para o Chart.js
  const routes = Array.from(new Set(history.map(h => `${h.origin}→${h.destination}`)));
  const timestamps = Array.from(new Set(history.map(h => h.timestamp.split("T")[0]))).slice(-30); // últimos 30 dias de checks
  
  const stats = {
    totalChecks: history.length,
    lowestPrice: history.reduce((min, h) => (h.cheapestPriceBRL && h.cheapestPriceBRL < min) ? h.cheapestPriceBRL : min, 999999),
    routesCount: routes.length,
    lastUpdate: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
  };

  return `
<!DOCTYPE html>
<html lang="pt-BR" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Flight Tracker Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
    <script src="https://unpkg.com/@phosphor-icons/web"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Inter', sans-serif; }
        .chart-container { position: relative; height: 350px; width: 100%; }
        .glass { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.1); }
    </style>
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        primary: '#3b82f6',
                        secondary: '#6366f1',
                    }
                }
            }
        }
    </script>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen">
    <div class="max-w-7xl mx-auto px-4 py-8">
        <!-- Header -->
        <header class="flex justify-between items-center mb-10">
            <div>
                <h1 class="text-3xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent flex items-center gap-3">
                    <i class="ph-bold ph-airplane-tilt"></i>
                    Flight Price Dashboard
                </h1>
                <p class="text-slate-400 mt-1">Acompanhamento de preços e previsões em tempo real</p>
            </div>
            <div class="text-right">
                <span class="px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm font-medium">
                    Última atualização: ${stats.lastUpdate}
                </span>
            </div>
        </header>

        <!-- Stats Cards -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
            <div class="glass p-6 rounded-2xl">
                <div class="flex items-start justify-between">
                    <div>
                        <p class="text-slate-400 text-sm font-medium mb-1">Total de Buscas</p>
                        <h3 class="text-2xl font-bold">${stats.totalChecks.toLocaleString()}</h3>
                    </div>
                    <div class="p-3 bg-blue-500/10 rounded-lg text-blue-400">
                        <i class="ph-bold ph-magnifying-glass text-xl"></i>
                    </div>
                </div>
            </div>
            
            <div class="glass p-6 rounded-2xl">
                <div class="flex items-start justify-between">
                    <div>
                        <p class="text-slate-400 text-sm font-medium mb-1">Menor Preço Encontrado</p>
                        <h3 class="text-2xl font-bold text-green-400">R$ ${stats.lowestPrice === 999999 ? '---' : stats.lowestPrice.toLocaleString()}</h3>
                    </div>
                    <div class="p-3 bg-green-500/10 rounded-lg text-green-400">
                        <i class="ph-bold ph-currency-circle-dollar text-xl"></i>
                    </div>
                </div>
            </div>

            <div class="glass p-6 rounded-2xl">
                <div class="flex items-start justify-between">
                    <div>
                        <p class="text-slate-400 text-sm font-medium mb-1">Rotas Ativas</p>
                        <h3 class="text-2xl font-bold">${stats.routesCount}</h3>
                    </div>
                    <div class="p-3 bg-indigo-500/10 rounded-lg text-indigo-400">
                        <i class="ph-bold ph-map-trifold text-xl"></i>
                    </div>
                </div>
            </div>

            <div class="glass p-6 rounded-2xl">
                <div class="flex items-start justify-between">
                    <div>
                        <p class="text-slate-400 text-sm font-medium mb-1">Status do Bot</p>
                        <h3 class="text-2xl font-bold text-emerald-400">Online</h3>
                    </div>
                    <div class="p-3 bg-emerald-500/10 rounded-lg text-emerald-400">
                        <i class="ph-bold ph-check-circle text-xl"></i>
                    </div>
                </div>
            </div>
        </div>

        <!-- Charts Row -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
            <!-- Price Evolution -->
            <div class="lg:col-span-2 glass p-6 rounded-3xl">
                <h4 class="text-lg font-semibold mb-6 flex items-center gap-2">
                    <i class="ph-bold ph-chart-line text-blue-400"></i>
                    Evolução dos Preços (Últimos ${timestamps.length} dias)
                </h4>
                <div class="chart-container">
                    <canvas id="priceEvolutionChart"></canvas>
                </div>
            </div>

            <!-- Savings Progress -->
            <div class="glass p-6 rounded-3xl">
                <h4 class="text-lg font-semibold mb-6 flex items-center gap-2">
                    <i class="ph-bold ph-lightning text-yellow-400"></i>
                    Distribuição por Rota
                </h4>
                <div class="chart-container">
                    <canvas id="routeDistributionChart"></canvas>
                </div>
            </div>
        </div>

        <!-- Bottom Row -->
        <div class="grid grid-cols-1 lg:grid-cols-1 gap-6">
            <div class="glass rounded-3xl overflow-hidden">
                <div class="p-6 border-b border-white/5 bg-white/5">
                    <h4 class="text-lg font-semibold flex items-center gap-2">
                        <i class="ph-bold ph-list-bullets text-indigo-400"></i>
                        Histórico Recente de Ofertas
                    </h4>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-left">
                        <thead class="text-slate-500 text-xs uppercase font-semibold">
                            <tr>
                                <th class="px-6 py-4">Data</th>
                                <th class="px-6 py-4">Rota</th>
                                <th class="px-6 py-4">Voo</th>
                                <th class="px-6 py-4">Preço (BRL)</th>
                                <th class="px-6 py-4">Total Resultados</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-white/5">
                            ${history.slice(-10).reverse().map(h => `
                                <tr class="hover:bg-white/5 transition-colors">
                                    <td class="px-6 py-4 text-sm text-slate-400 font-mono">${h.timestamp.split('T')[0]}</td>
                                    <td class="px-6 py-4 font-medium">${h.origin} ➔ ${h.destination}</td>
                                    <td class="px-6 py-4 text-sm text-slate-300">Em ${h.departureDate}</td>
                                    <td class="px-6 py-4 font-bold ${h.cheapestPriceBRL && h.cheapestPriceBRL < 500 ? 'text-green-400' : 'text-slate-100'}">
                                        R$ ${h.cheapestPriceBRL?.toLocaleString() ?? '---'}
                                    </td>
                                    <td class="px-6 py-4">
                                        <span class="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-xs">${h.totalFound} voos</span>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- Footer -->
        <footer class="mt-16 text-center text-slate-500 text-sm">
            <p>Gerado automaticamente por Flight Tracker SaaS &copy; 2024</p>
        </footer>
    </div>

    <script>
        const rawHistory = ${JSON.stringify(history)};
        const uniqueTimestamps = ${JSON.stringify(timestamps)};
        const uniqueRoutes = ${JSON.stringify(routes)};

        // Prepara datasets para o gráfico de evolução
        const datasets = uniqueRoutes.map((route, i) => {
            const colors = [
                { border: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)' },
                { border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)' },
                { border: '#ec4899', bg: 'rgba(236, 72, 153, 0.1)' },
                { border: '#10b981', bg: 'rgba(16, 185, 129, 0.1)' }
            ];
            const color = colors[i % colors.length];
            
            const data = uniqueTimestamps.map(day => {
                const entry = rawHistory.find(h => 
                    h.timestamp.startsWith(day) && 
                    \`\${h.origin}→\${h.destination}\` === route
                );
                return entry ? entry.cheapestPriceBRL : null;
            });

            return {
                label: route,
                data: data,
                borderColor: color.border,
                backgroundColor: color.bg,
                fill: true,
                tension: 0.4,
                pointRadius: 4,
                pointHoverRadius: 6
            };
        });

        // Configuração dos Gráficos
        Chart.defaults.color = '#94a3b8';
        Chart.defaults.font.family = 'Inter';

        // 1. Gráfico de Evolução
        new Chart(document.getElementById('priceEvolutionChart'), {
            type: 'line',
            data: { labels: uniqueTimestamps.map(t => t.split('-').slice(1).reverse().join('/')), datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'top', align: 'end' }, tooltip: { mode: 'index', intersect: false } },
                scales: {
                    x: { grid: { display: false } },
                    y: { grid: { color: 'rgba(255,255,255,0.05)' }, border: { dash: [4, 4] } }
                }
            }
        });

        // 2. Gráfico de Distribuição
        const distributionData = uniqueRoutes.map(route => rawHistory.filter(h => \`\${h.origin}→\${h.destination}\` === route).length);
        new Chart(document.getElementById('routeDistributionChart'), {
            type: 'doughnut',
            data: {
                labels: uniqueRoutes,
                datasets: [{
                    data: distributionData,
                    backgroundColor: ['#3b82f6', '#6366f1', '#ec4899', '#f59e0b'],
                    borderWidth: 0,
                    hoverOffset: 10
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' } },
                cutout: '70%'
            }
        });
    </script>
</body>
</html>
  `;
}

generate().catch(err => {
  console.error(err);
  process.exit(1);
});

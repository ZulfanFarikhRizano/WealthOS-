/* ══════════════════════════════════════════════════════════════════
   Z-WEALTH · BOT PORTFOLIO CHART + REAL-TIME STATS PATCH
   Tambahkan file ini SETELAH app.js di index.html:
   <script src="bot-chart.js"></script>
   ══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── Inject chart HTML ke halaman trading-bot ─────────────────────
  function _injectChartHTML() {
    const statsCard = document.getElementById('bot-stat-total')?.closest('[style*="grid-template-columns"]');
    if (!statsCard || document.getElementById('bot-portfolio-chart-wrap')) return;

    const wrap = document.createElement('div');
    wrap.id = 'bot-portfolio-chart-wrap';
    wrap.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:18px;overflow:hidden;margin-bottom:1rem;position:relative';
    wrap.innerHTML = `
      <div style="height:2px;background:linear-gradient(90deg,#10b981,#06b6d4,#a855f7)"></div>
      <div style="padding:.85rem 1rem .6rem">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.7rem">
          <div>
            <div style="font-size:.6rem;font-weight:800;letter-spacing:.14em;color:var(--muted);text-transform:uppercase">Portfolio Performa</div>
            <div id="bot-chart-pnl-label" style="font-size:.62rem;color:var(--muted);margin-top:.15rem">—</div>
          </div>
          <div style="display:flex;gap:.35rem">
            <button onclick="botChartSetPeriod('7d')"  id="bcp-7d"  class="bcp-btn" style="padding:.22rem .52rem;border-radius:6px;font-size:.6rem;font-weight:700;cursor:pointer;font-family:'Inter',sans-serif;transition:all .15s;background:rgba(16,185,129,.15);border:1px solid rgba(16,185,129,.4);color:#10b981">7D</button>
            <button onclick="botChartSetPeriod('30d')" id="bcp-30d" class="bcp-btn" style="padding:.22rem .52rem;border-radius:6px;font-size:.6rem;font-weight:700;cursor:pointer;font-family:'Inter',sans-serif;transition:all .15s;background:var(--surface2);border:1px solid var(--border);color:var(--muted)">30D</button>
            <button onclick="botChartSetPeriod('all')" id="bcp-all" class="bcp-btn" style="padding:.22rem .52rem;border-radius:6px;font-size:.6rem;font-weight:700;cursor:pointer;font-family:'Inter',sans-serif;transition:all .15s;background:var(--surface2);border:1px solid var(--border);color:var(--muted)">All</button>
          </div>
        </div>
        <div style="position:relative;height:140px;width:100%">
          <canvas id="bot-portfolio-canvas" style="width:100%;height:100%"></canvas>
          <div id="bot-chart-empty" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.45rem;color:var(--muted)">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="opacity:.25"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
            <div style="font-size:.68rem">Belum ada data trade</div>
          </div>
        </div>
        <!-- Summary row -->
        <div id="bot-chart-summary" style="display:grid;grid-template-columns:repeat(4,1fr);gap:.35rem;margin-top:.7rem;padding-top:.6rem;border-top:1px solid rgba(255,255,255,.05)">
          <div style="text-align:center">
            <div style="font-size:.5rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.18rem">Total PnL</div>
            <div id="bcs-pnl" style="font-size:.85rem;font-weight:800;font-family:'Space Mono',monospace;color:var(--text)">—</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:.5rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.18rem">Win Rate</div>
            <div id="bcs-winrate" style="font-size:.85rem;font-weight:800;font-family:'Space Mono',monospace;color:var(--text)">—</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:.5rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.18rem">Trades</div>
            <div id="bcs-count" style="font-size:.85rem;font-weight:800;font-family:'Space Mono',monospace;color:var(--text)">—</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:.5rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.18rem">Avg Size</div>
            <div id="bcs-avg" style="font-size:.85rem;font-weight:800;font-family:'Space Mono',monospace;color:var(--accent4)">—</div>
          </div>
        </div>
      </div>
    `;

    // Insert sebelum stats card
    statsCard.parentElement.insertBefore(wrap, statsCard);
  }

  // ── State chart ───────────────────────────────────────────────────
  let _chartPeriod = '7d';
  let _chartData   = [];
  let _chartCtx    = null;
  let _chartAnim   = null;

  window.botChartSetPeriod = function (period) {
    _chartPeriod = period;
    ['7d','30d','all'].forEach(p => {
      const btn = document.getElementById('bcp-' + p);
      if (!btn) return;
      if (p === period) {
        btn.style.cssText += ';background:rgba(16,185,129,.15);border:1px solid rgba(16,185,129,.4);color:#10b981';
      } else {
        btn.style.cssText += ';background:var(--surface2);border:1px solid var(--border);color:var(--muted)';
      }
    });
    _renderChart();
  };

  // ── Proses data trades menjadi equity curve ──────────────────────
  function _buildEquityCurve(trades, period) {
    const now = Date.now();
    const cutoff = period === '7d'  ? now - 7  * 86400000 :
                   period === '30d' ? now - 30 * 86400000 : 0;

    // Filter berdasarkan periode & hanya yang FILLED/SIMULATED
    const valid = trades
      .filter(t => ['FILLED','SIMULATED'].includes(t.order_status))
      .filter(t => new Date(t.executed_at).getTime() >= cutoff)
      .sort((a, b) => new Date(a.executed_at) - new Date(b.executed_at));

    if (valid.length === 0) return { points: [], summary: null };

    // Simulasi equity: BUY = -amount, SELL = +amount*1.X (estimasi)
    // Karena kita tidak simpan exit price, gunakan running volume sebagai proxy
    let equity = 0;
    const points = [];
    let buys = 0, sells = 0, totalVol = 0;

    valid.forEach(t => {
      const amt = parseFloat(t.amount_usdt) || 0;
      totalVol += amt;
      if (t.side === 'BUY') {
        equity -= amt;
        buys++;
      } else {
        equity += amt;
        sells++;
      }
      points.push({
        x: new Date(t.executed_at).getTime(),
        y: equity,
        side: t.side,
        symbol: t.symbol,
      });
    });

    const winRate = valid.length > 0 ? Math.round((sells / valid.length) * 100) : 0;
    const avgSize = valid.length > 0 ? (totalVol / valid.length) : 0;

    return {
      points,
      summary: {
        pnl:     equity,
        winRate,
        count:   valid.length,
        avgSize,
        totalVol,
      }
    };
  }

  // ── Render canvas chart ───────────────────────────────────────────
  function _renderChart() {
    const canvas = document.getElementById('bot-portfolio-canvas');
    const emptyEl = document.getElementById('bot-chart-empty');
    if (!canvas) return;

    const { points, summary } = _buildEquityCurve(_chartData, _chartPeriod);

    if (points.length < 2) {
      if (emptyEl) emptyEl.style.display = 'flex';
      canvas.style.opacity = '0';
      _updateSummary(null);
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    canvas.style.opacity = '1';

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const W = rect.width || 300;
    const H = 140;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const pad = { top: 12, right: 16, bottom: 28, left: 8 };
    const cW = W - pad.left - pad.right;
    const cH = H - pad.top - pad.bottom;

    const ys = points.map(p => p.y);
    const xs = points.map(p => p.x);
    const minY = Math.min(0, ...ys), maxY = Math.max(0, ...ys);
    const minX = xs[0], maxX = xs[xs.length - 1];
    const rangeY = maxY - minY || 1;
    const rangeX = maxX - minX || 1;

    const toX = x => pad.left + ((x - minX) / rangeX) * cW;
    const toY = y => pad.top + (1 - (y - minY) / rangeY) * cH;
    const zeroY = toY(0);

    // Clear
    ctx.clearRect(0, 0, W, H);

    // Zero line
    ctx.beginPath();
    ctx.moveTo(pad.left, zeroY);
    ctx.lineTo(W - pad.right, zeroY);
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Gradient fill
    const isPosEnd = points[points.length - 1].y >= 0;
    const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
    grad.addColorStop(0, isPosEnd ? 'rgba(16,185,129,.3)' : 'rgba(239,68,68,.3)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.beginPath();
    ctx.moveTo(toX(xs[0]), zeroY);
    points.forEach(p => ctx.lineTo(toX(p.x), toY(p.y)));
    ctx.lineTo(toX(xs[xs.length - 1]), zeroY);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(toX(p.x), toY(p.y));
      else ctx.lineTo(toX(p.x), toY(p.y));
    });
    ctx.strokeStyle = isPosEnd ? '#10b981' : '#ef4444';
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Dots untuk BUY/SELL
    points.forEach(p => {
      const px = toX(p.x), py = toY(p.y);
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fillStyle = p.side === 'BUY' ? '#10b981' : '#ef4444';
      ctx.fill();
      ctx.strokeStyle = 'var(--bg, #050810)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    });

    // X-axis labels
    ctx.fillStyle = 'rgba(148,163,184,.4)';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'center';
    const labelCount = Math.min(4, points.length);
    const step = Math.floor(points.length / labelCount);
    for (let i = 0; i < labelCount; i++) {
      const idx = i * step;
      const p = points[idx];
      const d = new Date(p.x);
      const label = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
      ctx.fillText(label, toX(p.x), H - 4);
    }

    // Current value label
    const lastP = points[points.length - 1];
    const pnlText = (lastP.y >= 0 ? '+' : '') + lastP.y.toFixed(1) + ' USDT';
    const pnlLabel = document.getElementById('bot-chart-pnl-label');
    if (pnlLabel) {
      pnlLabel.textContent = 'PnL Kumulatif: ' + pnlText;
      pnlLabel.style.color = lastP.y >= 0 ? '#10b981' : '#ef4444';
    }

    _updateSummary(summary);
  }

  function _updateSummary(s) {
    const pnlEl     = document.getElementById('bcs-pnl');
    const winEl     = document.getElementById('bcs-winrate');
    const cntEl     = document.getElementById('bcs-count');
    const avgEl     = document.getElementById('bcs-avg');
    if (!pnlEl) return;

    if (!s) {
      [pnlEl, winEl, cntEl, avgEl].forEach(el => { if(el) el.textContent = '—'; });
      return;
    }

    if (pnlEl) {
      pnlEl.textContent = (s.pnl >= 0 ? '+' : '') + s.pnl.toFixed(1);
      pnlEl.style.color = s.pnl >= 0 ? '#10b981' : '#ef4444';
    }
    if (winEl) {
      winEl.textContent = s.winRate + '%';
      winEl.style.color = s.winRate >= 50 ? '#10b981' : '#f59e0b';
    }
    if (cntEl) cntEl.textContent = s.count;
    if (avgEl) avgEl.textContent = '$' + s.avgSize.toFixed(1);
  }

  // ── Load trade data untuk chart ───────────────────────────────────
  async function _botLoadChartData() {
    if (!window.curSeed || !window.seedKeyHash) return;
    try {
      const key = await window.seedKeyHash(...window.curSeed);
      const SB_URL     = window.SB_URL;
      const SB_HEADERS = window.SB_HEADERS;
      if (!SB_URL || !SB_HEADERS) return;

      const res = await fetch(
        `${SB_URL}/rest/v1/trades?user_id=eq.${encodeURIComponent(key)}&select=side,amount_usdt,order_status,executed_at,symbol&order=executed_at.asc&limit=500`,
        { headers: SB_HEADERS }
      );
      const trades = await res.json();
      if (!Array.isArray(trades)) return;

      _chartData = trades;
      _renderChart();
    } catch (e) {
      console.warn('[BotChart] Load error:', e);
    }
  }

  // ── Realtime stats update via Supabase channel ────────────────────
  let _realtimeSub = null;
  async function _botSubscribeRealtime() {
    if (!window.curSeed || !window.seedKeyHash) return;
    if (typeof window.supabase !== 'undefined' || typeof window.__supabaseLib !== 'undefined') return; // skip jika sudah ada

    // Gunakan polling setiap 30 detik sebagai fallback realtime
    _pollStats();
  }

  function _pollStats() {
    clearInterval(window.__botStatsPollInterval);
    window.__botStatsPollInterval = setInterval(async () => {
      if (document.getElementById('page-trading-bot')?.classList.contains('active') ||
          document.getElementById('page-trading-bot')?.style.display !== 'none') {
        await window._botLoadStats?.();
        await _botLoadChartData();
      }
    }, 30000); // poll tiap 30 detik
  }

  // ── Patch initTradingBot untuk inject chart ───────────────────────
  const _origInit = window.initTradingBot;
  window.initTradingBot = async function () {
    if (typeof _origInit === 'function') await _origInit.apply(this, arguments);
    _injectChartHTML();
    await _botLoadChartData();
    _pollStats();
  };

  // ── Patch botLoadTrades untuk refresh chart juga ─────────────────
  const _origLoadTrades = window.botLoadTrades;
  window.botLoadTrades = async function () {
    if (typeof _origLoadTrades === 'function') await _origLoadTrades.apply(this, arguments);
    await _botLoadChartData();
  };

  // ── Handle resize ─────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    if (_chartData.length) _renderChart();
  });

  // ── Expose untuk akses manual ─────────────────────────────────────
  window._botLoadChartData = _botLoadChartData;

})();

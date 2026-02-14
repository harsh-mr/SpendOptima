// ======================================================
// Results Renderer — Dual Path + Acquisition Strategist
// ======================================================

export class ResultsRenderer {
    constructor(wallet) {
        this.wallet = wallet;
    }

    render(calcResult) {
        const section = document.getElementById('resultsSection');
        const heroSection = document.getElementById('heroSection');

        // Minimize hero on results
        heroSection.querySelector('.hero-title').style.display = 'none';
        heroSection.querySelector('.hero-subtitle').style.display = 'none';

        const { walletResults, globalResults, merchant, amount } = calcResult;
        const hasWallet = walletResults.length > 0;
        const globalBest = globalResults[0] || null;
        const walletBest = walletResults[0] || null;

        let html = `
      <div class="results-header">
        <h2 class="results-query">
          Best Card for <span class="results-query-merchant">${merchant.name}</span>
        </h2>
        <p class="results-amount">Spending ₹${amount.toLocaleString('en-IN')}</p>
      </div>
    `;

        if (hasWallet && walletBest) {
            html += this._renderWinnerCard(walletBest, amount);

            // Other cards from wallet
            if (walletResults.length > 1) {
                html += this._renderOtherCards(walletResults.slice(1));
            }

            // FOMO section: if global best is better than wallet best
            if (globalBest && globalBest.card.id !== walletBest.card.id &&
                globalBest.bestReturn > walletBest.bestReturn) {
                html += this._renderFomoSection(walletBest, globalBest, amount);
            }
        } else {
            // No wallet — show global results
            if (globalBest) {
                html += `
          <div class="no-wallet-cta">
            <p>🌍 Showing global best results. Set up your wallet for personalized recommendations!</p>
            <button class="cta-btn" id="resultsSetupWallet">
              <span>Set Up My Wallet</span>
              <span class="btn-arrow">→</span>
            </button>
          </div>
        `;
                html += this._renderWinnerCard(globalBest, amount);

                if (globalResults.length > 1) {
                    html += this._renderOtherCards(globalResults.slice(1, 6));
                }
            }
        }

        section.innerHTML = html;
        section.classList.remove('hidden');

        // Scroll to results
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // Bind dynamic events
        this._bindEvents(calcResult);
    }

    _renderWinnerCard(result, amount) {
        const { card, directRate, directReturn, voucherHack, voucherReturn, netProfit } = result;
        const hasHack = voucherHack && voucherReturn > directReturn;

        return `
      <div class="winner-card">
        <div class="winner-badge">🏆 Best Pick</div>
        <h3 class="winner-card-name">${card.name}</h3>
        <p class="winner-card-issuer">${card.issuer} • ${card.network.toUpperCase()} • ${card.annual_fee === 0 ? 'Lifetime Free' : '₹' + card.annual_fee.toLocaleString('en-IN') + '/yr'}</p>
        
        <div class="dual-path">
          <!-- Path A: Lazy / Direct -->
          <div class="path-card path-lazy">
            <div class="path-label">😴 Path A — Lazy</div>
            <div class="path-title">Swipe Direct on App</div>
            <div class="path-method">Pay directly with your card. No extra steps.</div>
            <div class="path-return">
              <span class="path-amount">₹${directReturn.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
              <span class="path-rate">${(directRate * 100).toFixed(1)}% return</span>
            </div>
          </div>

          <!-- Path B: Pro / Voucher Hack -->
          <div class="path-card path-pro">
            <div class="path-label">🚀 Path B — Pro</div>
            ${hasHack ? `
              <div class="path-title">Buy Voucher via Hack</div>
              <div class="path-method">${voucherHack.method}</div>
              <div class="path-return">
                <span class="path-amount">₹${voucherReturn.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                <span class="path-rate">${(voucherHack.rate * 100).toFixed(1)}% return</span>
              </div>
            ` : `
              <div class="path-title">No Hack Available</div>
              <div class="path-method">No voucher or portal hack for this card + merchant combo.</div>
              <div class="path-return">
                <span class="path-amount" style="opacity: 0.4">—</span>
                <span class="path-rate">N/A</span>
              </div>
            `}
          </div>
        </div>

        ${hasHack && netProfit > 0 ? `
          <div class="net-profit">
            <span class="net-profit-label">💰 Extra Savings with Path B</span>
            <span class="net-profit-value">+₹${netProfit.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
          </div>
        ` : ''}
      </div>
    `;
    }

    _renderOtherCards(results) {
        return `
      <div class="other-cards">
        <h4 class="other-cards-title">Other Cards in Your Wallet</h4>
        ${results.map(r => `
          <div class="other-card-item">
            <div>
              <div class="other-card-name">${r.card.name}</div>
              <div class="other-card-issuer">${r.card.issuer} • ${r.card.network.toUpperCase()}</div>
            </div>
            <div class="other-card-reward">
              <div class="other-card-amount">₹${r.bestReturn.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
              <div class="other-card-rate">${(Math.max(r.directRate, r.voucherHack?.rate || 0) * 100).toFixed(1)}% return</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    }

    _renderFomoSection(walletBest, globalBest, amount) {
        const diff = globalBest.bestReturn - walletBest.bestReturn;
        const card = globalBest.card;
        const acq = card.acquisition;

        return `
      <div class="fomo-section">
        <div class="fomo-badge">🔥 Could've Earned More</div>
        <p class="fomo-text">
          You earned <span class="fomo-highlight">₹${walletBest.bestReturn.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span> with ${walletBest.card.name}.
          But <span class="fomo-card-name">${card.name}</span> would have earned 
          <span class="fomo-highlight">₹${globalBest.bestReturn.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
          — that's <span class="fomo-highlight">₹${diff.toLocaleString('en-IN', { maximumFractionDigits: 0 })} more</span>!
        </p>
        
        <button class="fomo-toggle" id="fomoToggle">
          <span>How do I get ${card.name}?</span>
          <span class="fomo-toggle-arrow">▼</span>
        </button>

        <div class="acquisition-panel" id="acquisitionPanel">
          <h4 class="acquisition-title">Path to Approval</h4>
          
          <div style="margin-bottom: 16px; padding: 12px 16px; background: var(--bg-glass-strong); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
            <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Official Criteria</span>
            <p style="margin-top: 4px; font-weight: 500; color: var(--text-primary);">${acq.official_criteria}</p>
          </div>

          <div class="strategy-grid">
            ${acq.hacks.map(hack => `
              <div class="strategy-card">
                <div class="strategy-icon">${hack.icon || '💡'}</div>
                <div class="strategy-type">${hack.type.replace(/_/g, ' ')}</div>
                <h5 class="strategy-title">${hack.title}</h5>
                <p class="strategy-desc">${hack.description}</p>
                ${hack.link ? `<a href="${hack.link}" target="_blank" rel="noopener" class="strategy-link">Learn More →</a>` : ''}
              </div>
            `).join('')}
          </div>

          ${acq.application_link ? `
            <a href="${acq.application_link}" target="_blank" rel="noopener" class="apply-btn">
              Apply for ${card.name} →
            </a>
          ` : ''}
        </div>
      </div>
    `;
    }

    _bindEvents(calcResult) {
        // FOMO toggle
        const toggle = document.getElementById('fomoToggle');
        const panel = document.getElementById('acquisitionPanel');
        if (toggle && panel) {
            toggle.addEventListener('click', () => {
                toggle.classList.toggle('expanded');
                panel.classList.toggle('visible');
            });
        }

        // Setup wallet CTA (for users with no wallet)
        const setupBtn = document.getElementById('resultsSetupWallet');
        if (setupBtn) {
            setupBtn.addEventListener('click', () => {
                this.wallet.renderOnboardingModal(
                    calcResult.globalResults.map(r => r.card)
                );
            });
        }
    }

    hide() {
        const section = document.getElementById('resultsSection');
        section.classList.add('hidden');
        section.innerHTML = '';

        // Restore hero
        const heroSection = document.getElementById('heroSection');
        heroSection.querySelector('.hero-title').style.display = '';
        heroSection.querySelector('.hero-subtitle').style.display = '';
    }
}

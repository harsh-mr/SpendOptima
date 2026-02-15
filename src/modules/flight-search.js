// ======================================================
// SpendOptima — Net-Cost Flight Search Engine
// Re-ranks flights by effective cost after credit card rewards
// ======================================================

export class FlightSearchEngine {
    constructor(data, wallet) {
        this.data = data;
        this.wallet = wallet;
        this.flightData = data.flight_data;
        this.airports = this.flightData.airports || [];
        this.sampleFlights = this.flightData.sample_flights || [];
        this.caps = this.flightData.card_caps || {};
        this.transferPartners = this.flightData.transfer_partners || {};
        this.portals = this.flightData.flight_portals || [];
        this.airlines = this.flightData.airlines || [];

        // Build airport search items
        this.airportSearchItems = this.airports.map(a => ({
            name: `${a.city} (${a.code})`,
            code: a.code,
            city: a.city,
            fullName: a.name,
            type: 'airport'
        }));
    }

    /**
     * Search flights by route. Async so API can be swapped in later.
     */
    async search(fromCode, toCode) {
        // Level 1: Filter mock data. Level 2+: Replace with API call.
        return this.sampleFlights.filter(
            f => f.from === fromCode && f.to === toCode
        );
    }

    /**
     * Apply reward layer and re-rank flights by net cost
     */
    rankByNetCost(flights, showNetPrice = true) {
        const walletCards = this.wallet.getCards();
        const allCards = this.data.cards;
        const userCards = allCards.filter(c => walletCards.includes(c.id));

        const ranked = flights.map(flight => {
            const analysis = this._analyzeAllCards(flight, userCards.length > 0 ? userCards : allCards);
            const bestOption = analysis[0]; // Already sorted best-first

            const netCost = flight.price - (bestOption ? bestOption.pointsValue : 0);
            const savings = bestOption ? bestOption.pointsValue : 0;

            return {
                ...flight,
                netCost,
                savings,
                bestCard: bestOption ? bestOption.card : null,
                bestRoute: bestOption ? bestOption.route : null,
                bestRouteLabel: bestOption ? bestOption.routeLabel : null,
                pointsEarned: bestOption ? bestOption.pointsEarned : 0,
                pointsValue: bestOption ? bestOption.pointsValue : 0,
                allOptions: analysis,
                capWarning: bestOption ? bestOption.capWarning : null,
                hasWalletCards: userCards.length > 0
            };
        });

        // Sort by net cost or sticker price
        if (showNetPrice) {
            ranked.sort((a, b) => a.netCost - b.netCost);
        } else {
            ranked.sort((a, b) => a.price - b.price);
        }

        return ranked;
    }

    /**
     * Earn vs Burn analysis for a specific flight
     */
    getEarnVsBurn(flight, cardId) {
        const card = this.data.cards.find(c => c.id === cardId);
        if (!card) return null;

        const airline = this.airlines.find(a => a.id === flight.airline_id);
        const result = { options: [] };

        // Option 1: Pay Cash — Earn Points
        const portalAnalysis = this._getPortalReturn(card, flight.price);
        const directPoints = Math.round(flight.price * card.base_reward_rate);
        const directValue = Math.round(directPoints * (card.points_value || 1));

        result.options.push({
            type: 'earn_portal',
            label: 'Pay Cash via Portal',
            action: portalAnalysis
                ? `Pay ₹${flight.price.toLocaleString('en-IN')} on ${portalAnalysis.portal}. Earn ${portalAnalysis.pointsEarned.toLocaleString()} points.`
                : null,
            pointsEarned: portalAnalysis ? portalAnalysis.pointsEarned : 0,
            value: portalAnalysis ? portalAnalysis.value : 0,
            netCost: portalAnalysis ? flight.price - portalAnalysis.value : flight.price,
            verdict: portalAnalysis ? (portalAnalysis.value > directValue ? '✅ Best Portal Deal' : 'Portal available') : '❌ No portal for this card',
            available: !!portalAnalysis
        });

        result.options.push({
            type: 'earn_direct',
            label: 'Pay Cash — Direct Swipe',
            action: `Pay ₹${flight.price.toLocaleString('en-IN')} on airline website. Earn ${directPoints.toLocaleString()} points.`,
            pointsEarned: directPoints,
            value: directValue,
            netCost: flight.price - directValue,
            verdict: directValue > 0 ? `Earn ₹${directValue.toLocaleString('en-IN')} back` : 'Minimal returns',
            available: true
        });

        // Option 2: Pay with Points — Burn
        const pointsNeeded = Math.round(flight.price / (card.points_value || 1));
        const redemptionValue = flight.price / pointsNeeded;

        result.options.push({
            type: 'burn',
            label: 'Pay with Points',
            action: `Use ${pointsNeeded.toLocaleString()} points instead of ₹${flight.price.toLocaleString('en-IN')}.`,
            pointsNeeded,
            redemptionValue: redemptionValue.toFixed(2),
            netCost: 0,
            verdict: redemptionValue >= 0.80 ? '✅ Good Use of Points' : '⚠️ Low redemption value',
            available: true
        });

        // Option 3: Transfer to Airmiles
        if (airline) {
            const transfers = this.transferPartners[card.id] || [];
            const transfer = transfers.find(t => t.airline_id === airline.id);
            if (transfer && airline.sample_awards) {
                // Determine the right award tier based on class + route type
                const isDomestic = this._isDomesticRoute(flight.from, flight.to);
                const classPrefix = (flight.class || 'Economy').toLowerCase() === 'business' ? 'business' : 'economy';
                const routeSuffix = isDomestic ? 'domestic' : 'intl_short';
                const awardKey = `${classPrefix}_${routeSuffix}`;
                const milesNeeded = airline.sample_awards[awardKey] || airline.sample_awards.economy_domestic || 0;

                if (milesNeeded > 0) {
                    const pointsForTransfer = Math.ceil(milesNeeded * (transfer.ratio_from / transfer.ratio_to));

                    result.options.push({
                        type: 'transfer',
                        label: `Transfer to ${transfer.program}`,
                        action: `Transfer ${pointsForTransfer.toLocaleString()} points → ${milesNeeded.toLocaleString()} miles. Redeem for this flight.`,
                        pointsNeeded: pointsForTransfer,
                        milesNeeded,
                        cashSaved: flight.price,
                        netCost: 0,
                        verdict: '🏆 BEST OPTION! Transfer miles instead of paying cash.',
                        available: true,
                        isBest: true
                    });
                }
            }
        }

        // Sort: transfer first (if exists), then by net cost
        result.options.sort((a, b) => {
            if (a.isBest) return -1;
            if (b.isBest) return 1;
            return a.netCost - b.netCost;
        });

        result.bestOption = result.options[0];
        return result;
    }

    /**
     * Multi-card Earn vs Burn: analyze ALL wallet cards for a flight.
     * Returns { cards: [{ card, analysis }], bestCardId }
     */
    getMultiCardEarnVsBurn(flight, cardIds) {
        const results = [];

        for (const cardId of cardIds) {
            const card = this.data.cards.find(c => c.id === cardId);
            if (!card) continue;

            const analysis = this.getEarnVsBurn(flight, cardId);
            if (!analysis) continue;

            // Score: transfer option = 100, portal = 50, direct based on value
            const bestScore = analysis.options.reduce((max, opt) => {
                if (opt.type === 'transfer' && opt.available) return Math.max(max, 100);
                if (opt.type === 'earn_portal' && opt.available) return Math.max(max, 50 + opt.value);
                return Math.max(max, opt.value || 0);
            }, 0);

            results.push({ card, analysis, bestScore });
        }

        // Sort: best card first (transfer-capable cards win)
        results.sort((a, b) => b.bestScore - a.bestScore);

        const multiResult = {
            cards: results,
            bestCardId: results.length > 0 ? results[0].card.id : null
        };

        // Attach smart split strategy if beneficial
        multiResult.splitStrategy = this.getSmartSplit(flight, cardIds);

        return multiResult;
    }

    /**
     * Smart Split: calculate optimal multi-card payment split
     * when individual card portal caps limit rewards.
     * Uses greedy allocation: fill best-rate card to its cap, then next, etc.
     */
    getSmartSplit(flight, cardIds) {
        const price = flight.price;

        // Build list of portal-capable cards with their cap data
        const portalCards = [];
        for (const cardId of cardIds) {
            const card = this.data.cards.find(c => c.id === cardId);
            if (!card) continue;

            const portal = this.portals.find(p => p.supported_cards.includes(card.id));
            if (!portal) continue;

            const multiplierData = portal.reward_multiplier[card.id];
            if (!multiplierData) continue;

            const cap = this.caps[card.id];
            const capAmount = (cap && cap.monthly_cap_inr) ? cap.monthly_cap_inr : null;

            portalCards.push({
                card,
                portal: portal.name,
                rate: multiplierData.rate,
                label: multiplierData.label,
                capAmount,   // null means uncapped
                baseRate: card.base_reward_rate || 0
            });
        }

        if (portalCards.length < 2) return null; // Need 2+ portal cards to split

        // Sort by portal rate descending (best first)
        portalCards.sort((a, b) => b.rate - a.rate);

        // --- Calculate single best card earnings (for comparison) ---
        const bestSingle = portalCards[0];
        let singleCardEarnings;
        if (bestSingle.capAmount && price > bestSingle.capAmount) {
            // Capped: portal rate up to cap, base rate for remainder
            singleCardEarnings = Math.round(
                bestSingle.capAmount * bestSingle.rate +
                (price - bestSingle.capAmount) * bestSingle.baseRate
            );
        } else {
            singleCardEarnings = Math.round(price * bestSingle.rate);
        }

        // --- Greedy split allocation ---
        // Only split to cards whose portal rate beats the best card's base rate
        const bestBaseRate = bestSingle.baseRate;
        let remaining = price;
        const splits = [];
        let totalSplitEarnings = 0;

        for (const pc of portalCards) {
            if (remaining <= 0) break;

            // Skip if this card's portal rate isn't better than paying base rate on best card
            if (pc.rate <= bestBaseRate && pc !== portalCards[0]) continue;

            let allocate;
            if (pc.capAmount && remaining > pc.capAmount) {
                allocate = pc.capAmount;
            } else {
                allocate = remaining;
            }

            const earnings = Math.round(allocate * pc.rate);
            splits.push({
                card: pc.card,
                portal: pc.portal,
                amount: allocate,
                rate: pc.rate,
                label: pc.label,
                earnings
            });
            totalSplitEarnings += earnings;
            remaining -= allocate;
        }

        // If there's remaining amount not covered by any portal, add to best base-rate card
        if (remaining > 0) {
            // Find card with best base rate
            const allCards = cardIds
                .map(id => this.data.cards.find(c => c.id === id))
                .filter(Boolean)
                .sort((a, b) => (b.base_reward_rate || 0) - (a.base_reward_rate || 0));

            if (allCards.length > 0) {
                const fallback = allCards[0];
                const earnings = Math.round(remaining * (fallback.base_reward_rate || 0));
                splits.push({
                    card: fallback,
                    portal: 'Direct Swipe',
                    amount: remaining,
                    rate: fallback.base_reward_rate || 0,
                    label: 'Base rate',
                    earnings
                });
                totalSplitEarnings += earnings;
                remaining = 0;
            }
        }

        const benefit = totalSplitEarnings - singleCardEarnings;

        // Only return if split is meaningfully better (>₹100 benefit)
        if (benefit <= 100 || splits.length < 2) return null;

        return {
            splits,
            totalEarnings: totalSplitEarnings,
            singleCardEarnings,
            singleCardName: bestSingle.card.name,
            benefit
        };
    }

    // ---- Private ----

    _analyzeAllCards(flight, cards) {
        const results = [];

        cards.forEach(card => {
            // Check portal route
            const portalResult = this._getPortalReturn(card, flight.price);
            if (portalResult) {
                results.push({
                    card,
                    route: 'portal',
                    routeLabel: portalResult.portal,
                    pointsEarned: portalResult.pointsEarned,
                    pointsValue: portalResult.value,
                    capWarning: portalResult.capWarning
                });
            }

            // Check direct route
            const directPoints = Math.round(flight.price * card.base_reward_rate);
            const directValue = Math.round(directPoints * (card.points_value || 1));
            results.push({
                card,
                route: 'direct',
                routeLabel: 'Direct Swipe',
                pointsEarned: directPoints,
                pointsValue: directValue,
                capWarning: null
            });
        });

        // Sort by value (best first)
        results.sort((a, b) => b.pointsValue - a.pointsValue);
        return results;
    }

    _getPortalReturn(card, price) {
        const portal = this.portals.find(p => p.supported_cards.includes(card.id));
        if (!portal) return null;

        const multiplierData = portal.reward_multiplier[card.id];
        if (!multiplierData) return null;

        const cap = this.caps[card.id];
        let pointsEarned = Math.round(price * multiplierData.rate / (card.points_value || 1));
        let value = Math.round(price * multiplierData.rate);
        let capWarning = null;

        if (cap && cap.monthly_cap_inr && price > cap.monthly_cap_inr) {
            const cappedValue = Math.round(cap.monthly_cap_inr * multiplierData.rate);
            const overCapValue = Math.round((price - cap.monthly_cap_inr) * card.base_reward_rate);
            value = cappedValue + overCapValue;
            pointsEarned = Math.round(value / (card.points_value || 1));
            capWarning = {
                capAmount: cap.monthly_cap_inr,
                overAmount: price - cap.monthly_cap_inr,
                portal: portal.name
            };
        }

        return {
            portal: portal.name,
            pointsEarned,
            value,
            rate: multiplierData.rate,
            label: multiplierData.label,
            capWarning
        };
    }

    _isDomesticRoute(from, to) {
        const indianAirports = new Set(['DEL', 'BOM', 'BLR', 'MAA', 'HYD', 'CCU', 'COK', 'PNQ', 'AMD', 'GOI', 'JAI', 'LKO', 'GAU', 'IXC', 'SXR', 'VNS', 'NAG']);
        return indianAirports.has(from) && indianAirports.has(to);
    }
}

// ======================================================
// Flight Search Results Renderer
// ======================================================

export class FlightSearchRenderer {
    constructor() {
        this.container = document.getElementById('flightSearchResults');
    }

    renderSearchResults(rankedFlights, showNetPrice, route) {
        if (!rankedFlights || rankedFlights.length === 0) {
            this.container.innerHTML = `
                <div class="fs-no-results">
                    <div class="fs-no-results-icon">✈️</div>
                    <p>No flights found for this route.</p>
                    <p class="fs-no-results-hint">Try: BLR → DEL, BLR → SIN, BOM → LHR, DEL → DXB, or BLR → BKK</p>
                </div>
            `;
            this.container.classList.remove('hidden');
            return;
        }

        const fromCity = rankedFlights[0].from;
        const toCity = rankedFlights[0].to;

        let html = `
            <div class="fs-header">
                <h2 class="fs-title">
                    ${fromCity} → ${toCity}
                    <span class="fs-count">${rankedFlights.length} flights</span>
                </h2>
                <p class="fs-sort-label">
                    Sorted by: <strong>${showNetPrice ? '🏷️ Net Effective Price' : '💰 Sticker Price'}</strong>
                </p>
            </div>
        `;

        rankedFlights.forEach((flight, idx) => {
            html += this._renderFlightCard(flight, idx, showNetPrice);
        });

        this.container.innerHTML = html;
        this.container.classList.remove('hidden');
        this._bindEvents();
    }

    hide() {
        this.container.classList.add('hidden');
        this.container.innerHTML = '';
    }

    _renderFlightCard(flight, index, showNetPrice) {
        const isWinner = index === 0 && showNetPrice;
        const savingsPercent = flight.price > 0 ? Math.round((flight.savings / flight.price) * 100) : 0;

        return `
            <div class="fs-card ${isWinner ? 'fs-card-winner' : ''}" data-flight-idx="${index}">
                ${isWinner ? '<div class="fs-winner-badge">🏆 Best Net Cost</div>' : ''}
                <div class="fs-card-main">
                    <div class="fs-airline">
                        <div class="fs-airline-name">${flight.airline_name}</div>
                        <div class="fs-flight-no">${flight.flight_no} • ${flight.class}</div>
                    </div>
                    <div class="fs-schedule">
                        <div class="fs-time">${flight.departure}</div>
                        <div class="fs-route-line">
                            <div class="fs-route-dot"></div>
                            <div class="fs-route-bar"></div>
                            ${flight.stops > 0 ? `<div class="fs-stop-dot" title="Via ${flight.via || ''}"></div>` : ''}
                            <div class="fs-route-dot"></div>
                        </div>
                        <div class="fs-time">${flight.arrival}</div>
                    </div>
                    <div class="fs-duration">
                        <span>${flight.duration}</span>
                        <span class="fs-stops">${flight.stops === 0 ? 'Non-stop' : `${flight.stops} stop`}</span>
                    </div>
                    <div class="fs-pricing">
                        ${showNetPrice && flight.savings > 0 ? `
                            <div class="fs-sticker-price">₹${flight.price.toLocaleString('en-IN')}</div>
                            <div class="fs-net-price">₹${flight.netCost.toLocaleString('en-IN')}</div>
                            <div class="fs-savings-badge">Save ₹${flight.savings.toLocaleString('en-IN')} (${savingsPercent}%)</div>
                        ` : `
                            <div class="fs-net-price fs-no-savings">₹${flight.price.toLocaleString('en-IN')}</div>
                        `}
                    </div>
                </div>
                ${flight.bestCard && showNetPrice ? `
                    <div class="fs-card-footer">
                        <span class="fs-card-rec">💳 ${flight.bestCard.name}</span>
                        <span class="fs-card-route">${flight.bestRouteLabel}</span>
                        ${flight.capWarning ? '<span class="fs-cap-badge">⚠️ Cap</span>' : ''}
                        <button class="fs-evb-btn" data-flight-id="${flight.id}">Earn vs Burn ▸</button>
                    </div>
                ` : ''}
                <div class="fs-evb-drawer hidden" id="evb-${flight.id}">
                    <!-- Populated on click -->
                </div>
            </div>
        `;
    }

    renderEarnVsBurn(flightId, multiResult) {
        const drawer = document.getElementById(`evb-${flightId}`);
        if (!drawer || !multiResult || multiResult.cards.length === 0) return;

        const bestCardId = multiResult.bestCardId;

        // Build card tabs
        let tabsHtml = '<div class="evb-card-tabs">';
        multiResult.cards.forEach((entry, i) => {
            const isBest = entry.card.id === bestCardId;
            const isActive = i === 0;
            tabsHtml += `
                <button class="evb-card-tab ${isActive ? 'active' : ''}" data-card-id="${entry.card.id}">
                    ${isBest ? '⭐ ' : ''}${entry.card.name}
                </button>
            `;
        });
        tabsHtml += '</div>';

        // Build per-card analysis panels
        let panelsHtml = '';
        multiResult.cards.forEach((entry, i) => {
            const isActive = i === 0;
            const isBestCard = entry.card.id === bestCardId;
            panelsHtml += `<div class="evb-card-panel ${isActive ? '' : 'hidden'}" data-panel-card="${entry.card.id}">`;

            if (isBestCard) {
                panelsHtml += '<div class="evb-best-card-badge">🏆 Best Card for This Flight</div>';
            }

            entry.analysis.options.forEach(opt => {
                if (!opt.available && opt.type === 'earn_portal') return;

                const isBest = opt.isBest || false;
                panelsHtml += `
                    <div class="evb-option ${isBest ? 'evb-best' : ''} ${!opt.available ? 'evb-unavailable' : ''}">
                        <div class="evb-option-header">
                            <span class="evb-option-label">${opt.label}</span>
                            <span class="evb-verdict">${opt.verdict}</span>
                        </div>
                        <p class="evb-action">${opt.action || 'Not available for this card.'}</p>
                        <div class="evb-meta">
                            ${opt.type === 'burn' || opt.type === 'transfer'
                        ? `<span>Points needed: ${(opt.pointsNeeded || 0).toLocaleString()}</span>`
                        : `<span>Points earned: ${(opt.pointsEarned || 0).toLocaleString()}</span>`
                    }
                            <span>Net cost: ₹${(opt.netCost || 0).toLocaleString('en-IN')}</span>
                        </div>
                    </div>
                `;
            });

            panelsHtml += '</div>';
        });

        // Build Smart Split section if available
        let splitHtml = '';
        if (multiResult.splitStrategy) {
            const ss = multiResult.splitStrategy;
            splitHtml += '<div class="evb-split-strategy">';
            splitHtml += '<div class="evb-split-header">✂️ Smart Split Strategy</div>';
            splitHtml += `<p class="evb-split-desc">Split this payment across ${ss.splits.length} cards to earn <strong>₹${ss.benefit.toLocaleString('en-IN')} more</strong> than paying entirely on ${ss.singleCardName}.</p>`;

            splitHtml += '<div class="evb-split-rows">';
            ss.splits.forEach(s => {
                splitHtml += `
                    <div class="evb-split-row">
                        <div class="evb-split-card">
                            <span class="evb-split-card-name">💳 ${s.card.name}</span>
                            <span class="evb-split-portal">${s.portal}</span>
                        </div>
                        <div class="evb-split-amount">
                            <span class="evb-split-pay">Pay ₹${s.amount.toLocaleString('en-IN')}</span>
                            <span class="evb-split-earn">Earn ₹${s.earnings.toLocaleString('en-IN')} (${(s.rate * 100).toFixed(1)}%)</span>
                        </div>
                    </div>
                `;
            });
            splitHtml += '</div>';

            splitHtml += `
                <div class="evb-split-total">
                    <div class="evb-split-total-row">
                        <span>Total earnings (split)</span>
                        <span class="evb-split-value">₹${ss.totalEarnings.toLocaleString('en-IN')}</span>
                    </div>
                    <div class="evb-split-total-row evb-split-compare">
                        <span>vs. single card (${ss.singleCardName})</span>
                        <span>₹${ss.singleCardEarnings.toLocaleString('en-IN')}</span>
                    </div>
                    <div class="evb-split-total-row evb-split-benefit">
                        <span>💰 Extra savings</span>
                        <span class="evb-split-benefit-value">+₹${ss.benefit.toLocaleString('en-IN')}</span>
                    </div>
                </div>
            `;

            splitHtml += '</div>';
        }

        let html = '<div class="evb-content">';
        html += '<h4 class="evb-title">💡 Earn vs Burn Analysis</h4>';
        html += tabsHtml;
        html += panelsHtml;
        html += splitHtml;
        html += '</div>';

        drawer.innerHTML = html;
        drawer.classList.remove('hidden');

        // Bind tab click handlers
        drawer.querySelectorAll('.evb-card-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                // Update active tab
                drawer.querySelectorAll('.evb-card-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                // Show matching panel, hide others
                const targetCardId = tab.dataset.cardId;
                drawer.querySelectorAll('.evb-card-panel').forEach(panel => {
                    panel.classList.toggle('hidden', panel.dataset.panelCard !== targetCardId);
                });
            });
        });
    }

    _bindEvents() {
        this.container.querySelectorAll('.fs-evb-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const flightId = btn.dataset.flightId;
                const drawer = document.getElementById(`evb-${flightId}`);
                if (drawer && drawer.children.length > 0) {
                    drawer.classList.toggle('hidden');
                } else {
                    // Dispatch custom event for main.js to handle
                    this.container.dispatchEvent(new CustomEvent('earn-vs-burn', {
                        detail: { flightId },
                        bubbles: true
                    }));
                }
            });
        });
    }
}

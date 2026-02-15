// ======================================================
// SpendOptima — Flight Maximizer Module
// The Trinity of Booking: Portal vs Transfer vs Direct
// ======================================================

export class FlightMaximizer {
    constructor(data, wallet) {
        this.data = data;
        this.wallet = wallet;
        this.flightData = data.flight_data;
        this.airlines = this.flightData.airlines;
        this.portals = this.flightData.flight_portals;
        this.caps = this.flightData.card_caps;
        this.transferPartners = this.flightData.transfer_partners;

        // Build airline search index with keywords
        const merchantKW = data.merchant_keywords || {};
        this.airlineSearchItems = this.airlines.map(a => {
            const kws = merchantKW[a.name] || [];
            return {
                name: a.name,
                id: a.id,
                program: a.program,
                type: 'airline',
                keywords: kws.join(' ')
            };
        });
    }

    // ---- Public API ----

    /**
     * Main calculation: Compare all 3 routes for a flight
     */
    calculate(airlineId, ticketCost, milesRequired = null) {
        const walletCards = this.wallet.getCards();
        const allCards = this.data.cards;
        const airline = this.airlines.find(a => a.id === airlineId);
        if (!airline) return null;

        const walletResults = [];
        const globalResults = [];

        allCards.forEach(card => {
            const result = this._computeForCard(card, airline, ticketCost, milesRequired);
            if (walletCards.includes(card.id)) {
                walletResults.push(result);
            } else {
                globalResults.push(result);
            }
        });

        // Sort by best return
        walletResults.sort((a, b) => b.bestValue - a.bestValue);
        globalResults.sort((a, b) => b.bestValue - a.bestValue);

        return {
            airline,
            ticketCost,
            milesRequired,
            walletResults,
            globalBest: globalResults[0] || null,
            walletBest: walletResults[0] || null
        };
    }

    /**
     * Partner Lookup: Find which wallet cards can transfer to an airline
     */
    getTransferPartners(airlineId) {
        const walletCards = this.wallet.getCards();
        const allCards = this.data.cards;
        const results = [];

        allCards.forEach(card => {
            const partners = this.transferPartners[card.id] || [];
            const match = partners.find(p => p.airline_id === airlineId);
            const inWallet = walletCards.includes(card.id);

            if (match) {
                results.push({
                    card,
                    partner: match,
                    inWallet,
                    ratioLabel: `${match.ratio_from}:${match.ratio_to}`
                });
            }
        });

        // Also check alliance partners for hidden routes
        const airline = this.airlines.find(a => a.id === airlineId);
        const allianceHints = [];
        if (airline && airline.alliance_partners.length > 0) {
            airline.alliance_partners.forEach(partnerId => {
                const partnerAirline = this.airlines.find(a => a.id === partnerId);
                if (!partnerAirline) return;

                allCards.forEach(card => {
                    const partners = this.transferPartners[card.id] || [];
                    const match = partners.find(p => p.airline_id === partnerId);
                    if (match) {
                        // Check if this card already has a direct transfer to the target
                        const directMatch = results.find(r => r.card.id === card.id);
                        if (!directMatch) {
                            allianceHints.push({
                                card,
                                viaAirline: partnerAirline,
                                partner: match,
                                inWallet: walletCards.includes(card.id),
                                alliance: airline.alliance
                            });
                        }
                    }
                });
            });
        }

        return { directPartners: results, allianceHints, airline };
    }

    /**
     * Cap warning check
     * @param {string} cardId
     * @param {number} ticketCost - Full ticket cost
     * @param {number|null} milesValueINR - Cash value of miles being redeemed (reduces effective cash)
     */
    checkCapWarning(cardId, ticketCost, milesValueINR = null) {
        const cap = this.caps[cardId];
        if (!cap || !cap.monthly_cap_inr) return null;

        // If miles are being redeemed, the cash portion is lower
        const effectiveCashCost = milesValueINR ? Math.max(0, ticketCost - milesValueINR) : ticketCost;

        if (effectiveCashCost > cap.monthly_cap_inr) {
            const overCap = effectiveCashCost - cap.monthly_cap_inr;
            const today = new Date();
            const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
            const nextMonthStr = nextMonth.toLocaleDateString('en-IN', { month: 'long', day: 'numeric' });

            return {
                hasCap: true,
                capAmount: cap.monthly_cap_inr,
                overCapAmount: overCap,
                totalTicket: ticketCost,
                effectiveCashCost,
                milesDeduction: milesValueINR || 0,
                resetDate: nextMonthStr,
                portal: cap.portal,
                multiplier: cap.multiplier,
                splitSuggestion: this._generateSplitSuggestion(effectiveCashCost, cap, nextMonthStr),
                cardSplit: this._generateCardSplitSuggestion(cardId, effectiveCashCost)
            };
        }

        // If miles bring it under cap, show good news
        if (milesValueINR && ticketCost > cap.monthly_cap_inr && effectiveCashCost <= cap.monthly_cap_inr) {
            return {
                hasCap: false,
                milesHelped: true,
                milesDeduction: milesValueINR,
                effectiveCashCost,
                capAmount: cap.monthly_cap_inr,
                portal: cap.portal
            };
        }

        return { hasCap: false };
    }

    // ---- Private Methods ----

    _computeForCard(card, airline, ticketCost, milesRequired) {
        const cardCap = this.caps[card.id];
        const result = {
            card,
            portalRoute: null,
            transferRoute: null,
            directRoute: null,
            bestRoute: null,
            bestValue: 0,
            capWarning: null
        };

        // Route 1: Portal Route (SmartBuy / Travel Edge)
        const portal = this.portals.find(p => p.supported_cards.includes(card.id));

        // Pre-compute miles value for cap-aware calculations
        let milesValueINR = null;
        if (milesRequired) {
            const transfers = this.transferPartners[card.id] || [];
            const transfer = transfers.find(t => t.airline_id === airline.id);
            if (transfer) {
                milesValueINR = Math.round(milesRequired * transfer.estimated_value_inr);
            }
        }

        if (portal) {
            const multiplierData = portal.reward_multiplier[card.id];
            if (multiplierData) {
                // Use effective cash cost (after miles deduction) for portal return calc
                const effectiveCashCost = milesValueINR ? Math.max(0, ticketCost - milesValueINR) : ticketCost;
                let portalReturn = effectiveCashCost * multiplierData.rate;

                // Check cap against effective cash cost
                if (cardCap && cardCap.monthly_cap_inr && effectiveCashCost > cardCap.monthly_cap_inr) {
                    const cappedReturn = cardCap.monthly_cap_inr * multiplierData.rate;
                    const overCapReturn = (effectiveCashCost - cardCap.monthly_cap_inr) * card.base_reward_rate;
                    portalReturn = cappedReturn + overCapReturn;

                    result.capWarning = this.checkCapWarning(card.id, ticketCost, milesValueINR);
                } else if (milesValueINR && cardCap && cardCap.monthly_cap_inr && ticketCost > cardCap.monthly_cap_inr) {
                    // Miles brought effective cash under cap — show positive feedback
                    result.capWarning = this.checkCapWarning(card.id, ticketCost, milesValueINR);
                }

                result.portalRoute = {
                    portal: portal.name,
                    url: portal.url,
                    label: multiplierData.label,
                    rate: multiplierData.rate,
                    returnValue: Math.round(portalReturn),
                    capped: result.capWarning !== null && result.capWarning.hasCap
                };
            }
        }

        // Route 2: Transfer Route (Airmiles)
        const transfers = this.transferPartners[card.id] || [];
        const transfer = transfers.find(t => t.airline_id === airline.id);
        if (transfer && milesRequired) {
            const pointsNeeded = Math.ceil(milesRequired * (transfer.ratio_from / transfer.ratio_to));
            const milesValue = milesRequired * transfer.estimated_value_inr;

            // Compare: paying cash vs using points
            // Value = ticket cost minus the "cost" of points (if earned via spending)
            // Simplified: estimate savings as (ticketCost - pointsNeeded * base_point_cost)
            result.transferRoute = {
                program: transfer.program,
                ratio: `${transfer.ratio_from}:${transfer.ratio_to}`,
                pointsNeeded,
                milesRequired,
                estimatedSavings: Math.round(ticketCost - (pointsNeeded * 0.30)), // Avg earning cost ~₹0.30/point
                milesValueINR: Math.round(milesValue),
                airline: airline.name
            };
        }

        // Route 3: Direct Route (Swipe on airline website)
        const directRate = card.base_reward_rate;
        result.directRoute = {
            rate: directRate,
            returnValue: Math.round(ticketCost * directRate),
            label: `${(directRate * 100).toFixed(1)}% base rate`
        };

        // Determine best route
        const values = [];
        if (result.portalRoute) values.push({ route: 'portal', value: result.portalRoute.returnValue });
        if (result.transferRoute) values.push({ route: 'transfer', value: result.transferRoute.estimatedSavings });
        if (result.directRoute) values.push({ route: 'direct', value: result.directRoute.returnValue });

        values.sort((a, b) => b.value - a.value);
        if (values.length > 0) {
            result.bestRoute = values[0].route;
            result.bestValue = values[0].value;
        }

        return result;
    }

    _generateSplitSuggestion(ticketCost, cap, resetDate) {
        const halfCost = Math.ceil(ticketCost / 2);
        const isWithinCap = halfCost <= cap.monthly_cap_inr;

        if (isWithinCap) {
            return {
                strategy: 'split_equal',
                leg1: halfCost,
                leg2: ticketCost - halfCost,
                message: `Book outbound (₹${halfCost.toLocaleString('en-IN')}) this month. Book return (₹${(ticketCost - halfCost).toLocaleString('en-IN')}) on ${resetDate} to earn full rewards on both legs.`
            };
        } else {
            return {
                strategy: 'split_cap',
                leg1: cap.monthly_cap_inr,
                leg2: ticketCost - cap.monthly_cap_inr,
                message: `Or split by month: Book ₹${cap.monthly_cap_inr.toLocaleString('en-IN')} this month, remaining ₹${(ticketCost - cap.monthly_cap_inr).toLocaleString('en-IN')} on ${resetDate}.`
            };
        }
    }

    /**
     * Generate a cross-card split suggestion using other wallet cards
     */
    _generateCardSplitSuggestion(primaryCardId, ticketCost) {
        const walletCards = this.wallet.getCards();
        if (walletCards.length < 2) return null;

        const primaryCard = this.data.cards.find(c => c.id === primaryCardId);
        if (!primaryCard) return null;

        // Build list of portal-capable wallet cards with rates and caps
        const portalCards = [];
        for (const cardId of walletCards) {
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
                capAmount,
                baseRate: card.base_reward_rate || 0
            });
        }

        if (portalCards.length < 2) return null;

        // Sort by portal rate descending
        portalCards.sort((a, b) => b.rate - a.rate);

        const bestBaseRate = portalCards[0].baseRate;

        // Greedy allocation — only allocate to cards whose portal rate beats best base rate
        let remaining = ticketCost;
        const splits = [];
        let totalEarnings = 0;

        for (const pc of portalCards) {
            if (remaining <= 0) break;
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
            totalEarnings += earnings;
            remaining -= allocate;
        }

        // Remaining via best base-rate card
        if (remaining > 0) {
            const bestBase = walletCards
                .map(id => this.data.cards.find(c => c.id === id))
                .filter(Boolean)
                .sort((a, b) => (b.base_reward_rate || 0) - (a.base_reward_rate || 0))[0];

            if (bestBase) {
                const earnings = Math.round(remaining * (bestBase.base_reward_rate || 0));
                splits.push({
                    card: bestBase,
                    portal: 'Direct Swipe',
                    amount: remaining,
                    rate: bestBase.base_reward_rate || 0,
                    label: 'Base rate',
                    earnings
                });
                totalEarnings += earnings;
            }
        }

        // Calculate single-card earnings for comparison
        const primaryPortal = portalCards.find(pc => pc.card.id === primaryCardId);
        let singleEarnings = 0;
        if (primaryPortal) {
            if (primaryPortal.capAmount && ticketCost > primaryPortal.capAmount) {
                singleEarnings = Math.round(
                    primaryPortal.capAmount * primaryPortal.rate +
                    (ticketCost - primaryPortal.capAmount) * primaryPortal.baseRate
                );
            } else {
                singleEarnings = Math.round(ticketCost * primaryPortal.rate);
            }
        }

        const benefit = totalEarnings - singleEarnings;
        if (benefit <= 100 || splits.length < 2) return null;

        return {
            splits,
            totalEarnings,
            singleEarnings,
            benefit
        };
    }
}

// ======================================================
// Flight Results Renderer
// ======================================================

export class FlightResultsRenderer {
    constructor() {
        this.container = document.getElementById('flightResults');
    }

    render(calcResult, partnerLookup) {
        if (!calcResult) {
            this.container.innerHTML = '<p class="no-results">No results found.</p>';
            return;
        }

        const { airline, ticketCost, milesRequired, walletResults, globalBest, walletBest } = calcResult;

        let html = `
            <div class="flight-results-header">
                <h2 class="flight-results-title">
                    ✈️ <span class="results-query-merchant">${airline.name}</span>
                </h2>
                <p class="results-amount">Ticket Cost: ₹${ticketCost.toLocaleString('en-IN')}${milesRequired ? ` • ${milesRequired.toLocaleString()} miles entered` : ''}</p>
            </div>
        `;

        // Winner card — Trinity of Booking
        if (walletBest) {
            html += this._renderTrinityCard(walletBest, ticketCost);
        } else {
            html += `
                <div class="flight-empty-wallet">
                    <p>🛫 Add cards to your wallet to see personalized flight recommendations!</p>
                </div>
            `;
        }

        // Other wallet cards
        if (walletResults.length > 1) {
            html += `<div class="other-cards"><h3 class="other-cards-title">Other Cards in Your Wallet</h3>`;
            walletResults.slice(1).forEach(r => {
                html += this._renderOtherCard(r);
            });
            html += '</div>';
        }

        // Partner Lookup section
        if (partnerLookup) {
            html += this._renderPartnerLookup(partnerLookup);
        }

        // FOMO — global best
        if (globalBest && walletBest && globalBest.bestValue > walletBest.bestValue) {
            html += this._renderFlightFomo(globalBest, walletBest, ticketCost);
        }

        this.container.innerHTML = html;
        this.container.classList.remove('hidden');

        // Bind events
        this._bindEvents();
    }

    hide() {
        this.container.classList.add('hidden');
        this.container.innerHTML = '';
    }

    _renderTrinityCard(result, ticketCost) {
        const { card, portalRoute, transferRoute, directRoute, bestRoute, capWarning } = result;

        let capHTML = '';
        if (capWarning && capWarning.hasCap) {
            // Miles deduction info
            let milesDeductionHTML = '';
            if (capWarning.milesDeduction > 0) {
                milesDeductionHTML = `
                    <div class="cap-miles-note">
                        <span class="cap-miles-icon">✈️</span>
                        <p>After redeeming miles (₹${capWarning.milesDeduction.toLocaleString('en-IN')} value), cash portion is ₹${capWarning.effectiveCashCost.toLocaleString('en-IN')}</p>
                    </div>
                `;
            }

            // Build card split HTML if available
            let cardSplitHTML = '';
            if (capWarning.cardSplit) {
                const cs = capWarning.cardSplit;
                cardSplitHTML = `
                    <div class="cap-card-split">
                        <div class="cap-split-icon">💡</div>
                        <div class="cap-split-content">
                            <div class="cap-split-title">Split across your cards to earn <strong>₹${cs.benefit.toLocaleString('en-IN')} more</strong></div>
                            <div class="cap-split-rows">
                                ${cs.splits.map(s => `
                                    <div class="cap-split-row">
                                        <span class="cap-split-card">💳 ${s.card.name}</span>
                                        <span class="cap-split-portal">${s.portal}</span>
                                        <span class="cap-split-amount">₹${s.amount.toLocaleString('en-IN')}</span>
                                        <span class="cap-split-earn">→ ₹${s.earnings.toLocaleString('en-IN')} (${(s.rate * 100).toFixed(1)}%)</span>
                                    </div>
                                `).join('')}
                            </div>
                            <div class="cap-split-total">
                                Total: <strong>₹${cs.totalEarnings.toLocaleString('en-IN')}</strong> vs ₹${cs.singleEarnings.toLocaleString('en-IN')} on single card
                            </div>
                        </div>
                    </div>
                `;
            }

            // Monthly split as secondary option
            let monthlySplitHTML = '';
            if (capWarning.splitSuggestion) {
                monthlySplitHTML = `
                    <div class="cap-monthly-split">
                        <span class="cap-monthly-icon">📅</span>
                        <p>${capWarning.splitSuggestion.message}</p>
                    </div>
                `;
            }

            capHTML = `
                <div class="cap-warning">
                    <div class="cap-warning-icon">⚠️</div>
                    <div class="cap-warning-content">
                        <div class="cap-warning-title">Monthly Cap Alert!</div>
                        <p class="cap-warning-text">
                            Your <strong>${capWarning.portal}</strong> ${capWarning.multiplier} bonus caps at <strong>₹${capWarning.capAmount.toLocaleString('en-IN')}</strong>/month.
                            You will earn <strong>ZERO bonus points</strong> on the remaining ₹${capWarning.overCapAmount.toLocaleString('en-IN')}.
                        </p>
                        ${milesDeductionHTML}
                        ${cardSplitHTML}
                        ${monthlySplitHTML}
                    </div>
                </div>
            `;
        } else if (capWarning && capWarning.milesHelped) {
            // Miles brought the amount under cap — show good news
            capHTML = `
                <div class="cap-warning" style="border-color: rgba(52, 211, 153, 0.25); background: linear-gradient(135deg, rgba(52, 211, 153, 0.08), rgba(96, 165, 250, 0.08));">
                    <div class="cap-warning-icon">✅</div>
                    <div class="cap-warning-content">
                        <div class="cap-warning-title" style="color: var(--accent-green);">Miles Keep You Under Cap!</div>
                        <p class="cap-warning-text">
                            Full ticket exceeds <strong>${capWarning.portal}</strong> ₹${capWarning.capAmount.toLocaleString('en-IN')}/month cap,
                            but by redeeming miles (₹${capWarning.milesDeduction.toLocaleString('en-IN')} value), your cash portion is only
                            <strong>₹${capWarning.effectiveCashCost.toLocaleString('en-IN')}</strong> — within the cap! Full bonus rewards apply.
                        </p>
                    </div>
                </div>
            `;
        }

        return `
            <div class="winner-card flight-winner">
                <div class="winner-badge">🏆 Best Pick</div>
                <h3 class="winner-card-name">${card.name}</h3>
                <p class="winner-card-issuer">${card.issuer} • ${card.network.toUpperCase()} • ${card.annual_fee === 0 ? 'Lifetime Free' : '₹' + card.annual_fee.toLocaleString('en-IN') + '/yr'}</p>

                ${capHTML}

                <div class="trinity-grid">
                    <!-- Route 1: Portal -->
                    <div class="trinity-card ${bestRoute === 'portal' ? 'trinity-best' : ''}">
                        <div class="trinity-label">
                            ${bestRoute === 'portal' ? '🥇' : ''} 🌐 Portal Route
                        </div>
                        ${portalRoute ? `
                            <div class="trinity-title">${portalRoute.portal}</div>
                            <div class="trinity-method">${portalRoute.label}</div>
                            <div class="trinity-return">
                                <span class="trinity-amount ${portalRoute.capped ? 'capped' : ''}">₹${portalRoute.returnValue.toLocaleString('en-IN')}</span>
                                <span class="trinity-rate">${(portalRoute.rate * 100).toFixed(1)}% return${portalRoute.capped ? ' (capped)' : ''}</span>
                            </div>
                            <a href="${portalRoute.url}" target="_blank" class="trinity-link">Book on ${portalRoute.portal} →</a>
                        ` : `
                            <div class="trinity-title">Not Available</div>
                            <div class="trinity-method">This card has no portal booking rewards.</div>
                            <div class="trinity-return">
                                <span class="trinity-amount" style="opacity: 0.4">—</span>
                            </div>
                        `}
                    </div>

                    <!-- Route 2: Transfer -->
                    <div class="trinity-card ${bestRoute === 'transfer' ? 'trinity-best' : ''}">
                        <div class="trinity-label">
                            ${bestRoute === 'transfer' ? '🥇' : ''} 🔄 Transfer Route
                        </div>
                        ${transferRoute ? `
                            <div class="trinity-title">Transfer to ${transferRoute.program}</div>
                            <div class="trinity-method">Convert points at ${transferRoute.ratio} ratio</div>
                            <div class="trinity-detail">${transferRoute.pointsNeeded.toLocaleString()} points needed for ${transferRoute.milesRequired.toLocaleString()} miles</div>
                            <div class="trinity-return">
                                <span class="trinity-amount">₹${transferRoute.estimatedSavings.toLocaleString('en-IN')}</span>
                                <span class="trinity-rate">Est. savings vs cash</span>
                            </div>
                        ` : `
                            <div class="trinity-title">No Transfer Partner</div>
                            <div class="trinity-method">Enter miles required above, or this card has no transfer to this airline.</div>
                            <div class="trinity-return">
                                <span class="trinity-amount" style="opacity: 0.4">—</span>
                            </div>
                        `}
                    </div>

                    <!-- Route 3: Direct -->
                    <div class="trinity-card ${bestRoute === 'direct' ? 'trinity-best' : ''}">
                        <div class="trinity-label">
                            ${bestRoute === 'direct' ? '🥇' : ''} 💳 Direct Swipe
                        </div>
                        <div class="trinity-title">Swipe on Airline Site</div>
                        <div class="trinity-method">Pay on ${this._getCurrentAirlineName()} website directly</div>
                        <div class="trinity-return">
                            <span class="trinity-amount">₹${directRoute.returnValue.toLocaleString('en-IN')}</span>
                            <span class="trinity-rate">${directRoute.label}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    _renderOtherCard(result) {
        return `
            <div class="other-card-item">
                <div>
                    <div class="other-card-name">${result.card.name}</div>
                    <div class="other-card-issuer">${result.card.issuer} • ${result.card.network.toUpperCase()}</div>
                </div>
                <div class="other-card-reward">
                    <div class="other-card-amount">₹${result.bestValue.toLocaleString('en-IN')}</div>
                    <div class="other-card-rate">Best: ${result.bestRoute}</div>
                </div>
            </div>
        `;
    }

    _renderPartnerLookup(lookup) {
        const { directPartners, allianceHints, airline } = lookup;

        if (directPartners.length === 0 && allianceHints.length === 0) return '';

        let html = `
            <div class="partner-lookup">
                <h3 class="partner-lookup-title">🔍 Transfer Partners for ${airline.name}</h3>
                <p class="partner-lookup-subtitle">${airline.program} • ${airline.alliance}</p>
        `;

        if (directPartners.length > 0) {
            html += '<div class="partner-list">';
            directPartners.forEach(p => {
                html += `
                    <div class="partner-item ${p.inWallet ? '' : 'partner-not-owned'}">
                        <div class="partner-card-info">
                            <span class="partner-card-name">${p.card.name}</span>
                            <span class="partner-wallet-badge">${p.inWallet ? '✅ In Wallet' : '❌ Not Owned'}</span>
                        </div>
                        <div class="partner-details">
                            <span class="partner-ratio">Ratio: ${p.ratioLabel}</span>
                            <span class="partner-program">→ ${p.partner.program}</span>
                            <span class="partner-value">~₹${p.partner.estimated_value_inr.toFixed(2)}/mile</span>
                        </div>
                    </div>
                `;
            });
            html += '</div>';
        }

        if (allianceHints.length > 0) {
            html += `
                <div class="alliance-hints">
                    <h4 class="alliance-hints-title">🌍 Hidden Routes via ${airline.alliance} Alliance</h4>
            `;
            allianceHints.forEach(h => {
                html += `
                    <div class="alliance-hint-item">
                        <span class="ah-card">${h.card.name}</span>
                        <span class="ah-arrow">→</span>
                        <span class="ah-via">${h.viaAirline.name} (${h.viaAirline.program})</span>
                        <span class="ah-arrow">→</span>
                        <span class="ah-target">${airline.name}</span>
                        ${!h.inWallet ? '<span class="ah-not-owned">(Not Owned)</span>' : ''}
                    </div>
                `;
            });
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    _renderFlightFomo(globalBest, walletBest, ticketCost) {
        const diff = globalBest.bestValue - walletBest.bestValue;
        return `
            <div class="fomo-section flight-fomo">
                <div class="fomo-badge">🔥 Could've Earned More</div>
                <p class="fomo-text">
                    You earned <span class="fomo-highlight">₹${walletBest.bestValue.toLocaleString('en-IN')}</span> with ${walletBest.card.name}.
                    But <span class="fomo-card-name">${globalBest.card.name}</span> would have earned <span class="fomo-highlight">₹${globalBest.bestValue.toLocaleString('en-IN')}</span>
                    — that's <span class="fomo-highlight">₹${diff.toLocaleString('en-IN')} more</span>!
                </p>
            </div>
        `;
    }

    _getCurrentAirlineName() {
        const titleEl = this.container.querySelector('.results-query-merchant');
        return titleEl ? titleEl.textContent : 'the airline';
    }

    _bindEvents() {
        // Future: expand/collapse sections, etc.
    }
}

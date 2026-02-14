// ======================================================
// Calculator — Reward computation engine
// ======================================================

export class Calculator {
    constructor(data) {
        this.data = data;
    }

    /**
     * Calculate rewards for a specific merchant/category and amount.
     * @param {Object} searchItem - { name, type, category }
     * @param {number} amount
     * @param {string[]} walletCardIds - IDs of cards in user's wallet
     * @returns {Object} { walletResults, globalResults, merchant, amount }
     */
    calculate(searchItem, amount, walletCardIds) {
        const allResults = this._computeAll(searchItem, amount);

        const walletResults = allResults.filter(r => walletCardIds.includes(r.card.id));
        const globalResults = [...allResults];

        // Sort both by best effective return (max of direct and voucher)
        const sortFn = (a, b) => b.bestReturn - a.bestReturn;
        walletResults.sort(sortFn);
        globalResults.sort(sortFn);

        return {
            walletResults,
            globalResults,
            merchant: searchItem,
            amount,
        };
    }

    /**
     * Calculate for ALL cards
     */
    calculateGlobal(searchItem, amount) {
        const allResults = this._computeAll(searchItem, amount);
        allResults.sort((a, b) => b.bestReturn - a.bestReturn);
        return allResults;
    }

    _computeAll(searchItem, amount) {
        return this.data.cards.map(card => this._computeForCard(card, searchItem, amount));
    }

    _computeForCard(card, searchItem, amount) {
        let directRate = card.base_reward_rate;
        let voucherHack = null;

        if (searchItem.type === 'merchant') {
            // Find merchant-specific rate
            const merchantRule = card.merchants.find(
                m => m.name.toLowerCase() === searchItem.name.toLowerCase()
            );
            if (merchantRule) {
                directRate = merchantRule.direct_rate;
                voucherHack = merchantRule.voucher_hack;
            } else {
                // Merchant not found on this card — try category fallback
                const catRate = this._getCategoryRate(card, searchItem.category);
                if (catRate) directRate = catRate;
            }
        } else {
            // Category-based search
            const catRate = this._getCategoryRate(card, searchItem.name);
            if (catRate) directRate = catRate;
        }

        const directReturn = amount * directRate;
        const voucherReturn = voucherHack ? amount * voucherHack.rate : null;
        const bestReturn = Math.max(directReturn, voucherReturn || 0);

        return {
            card,
            directRate,
            directReturn: Math.round(directReturn * 100) / 100,
            voucherHack,
            voucherReturn: voucherReturn !== null ? Math.round(voucherReturn * 100) / 100 : null,
            bestReturn: Math.round(bestReturn * 100) / 100,
            netProfit: voucherReturn !== null
                ? Math.round((voucherReturn - directReturn) * 100) / 100
                : 0,
        };
    }

    _getCategoryRate(card, categoryName) {
        if (!categoryName) return null;
        const cat = card.categories.find(
            c => c.name.toLowerCase() === categoryName.toLowerCase()
        );
        return cat ? cat.direct_rate : null;
    }
}

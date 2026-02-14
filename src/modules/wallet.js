// ======================================================
// Wallet Manager — LocalStorage-based card wallet
// ======================================================

const STORAGE_KEY = 'spendoptima_wallet';
const FIRST_VISIT_KEY = 'spendoptima_visited';

export class WalletManager {
    constructor() {
        this._listeners = [];
    }

    isFirstVisit() {
        return !localStorage.getItem(FIRST_VISIT_KEY);
    }

    markVisited() {
        localStorage.setItem(FIRST_VISIT_KEY, 'true');
    }

    getCards() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            return data ? JSON.parse(data) : [];
        } catch {
            return [];
        }
    }

    setCards(ids) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
        this._emit();
    }

    hasCard(id) {
        return this.getCards().includes(id);
    }

    toggleCard(id) {
        const cards = this.getCards();
        const idx = cards.indexOf(id);
        if (idx === -1) {
            cards.push(id);
        } else {
            cards.splice(idx, 1);
        }
        this.setCards(cards);
        return cards;
    }

    count() {
        return this.getCards().length;
    }

    onChange(fn) {
        this._listeners.push(fn);
    }

    _emit() {
        const cards = this.getCards();
        this._listeners.forEach(fn => fn(cards));
    }

    // ---- UI Rendering ----

    renderOnboardingModal(allCards) {
        const modal = document.getElementById('onboardingModal');
        const grid = document.getElementById('cardGrid');
        const saveBtn = document.getElementById('saveWalletBtn');
        const skipBtn = document.getElementById('skipWalletBtn');

        this._renderCardGrid(grid, allCards);

        modal.classList.remove('hidden');

        const close = () => {
            modal.classList.add('hidden');
            this.markVisited();
        };

        saveBtn.onclick = () => {
            const selected = this._getSelectedFromGrid(grid);
            this.setCards(selected);
            close();
        };

        skipBtn.onclick = () => {
            this.setCards([]);
            close();
        };
    }

    renderWalletModal(allCards) {
        const modal = document.getElementById('walletModal');
        const grid = document.getElementById('walletCardGrid');
        const updateBtn = document.getElementById('updateWalletBtn');
        const closeBtn = document.getElementById('walletModalClose');

        this._renderCardGrid(grid, allCards, this.getCards());

        modal.classList.remove('hidden');

        const close = () => modal.classList.add('hidden');

        updateBtn.onclick = () => {
            const selected = this._getSelectedFromGrid(grid);
            this.setCards(selected);
            close();
        };

        closeBtn.onclick = close;

        modal.onclick = (e) => {
            if (e.target === modal) close();
        };
    }

    updatePillCount() {
        const el = document.getElementById('walletCount');
        if (el) el.textContent = this.count();
    }

    _renderCardGrid(container, allCards, selectedIds = []) {
        container.innerHTML = allCards.map(card => {
            const isSelected = selectedIds.includes(card.id);
            const feeText = card.annual_fee === 0 ? 'Lifetime Free' : `₹${card.annual_fee.toLocaleString('en-IN')}/yr`;
            const feeClass = card.annual_fee === 0 ? 'free' : '';

            return `
        <div class="card-tile ${isSelected ? 'selected' : ''}" data-card-id="${card.id}">
          <div class="card-tile-check">${isSelected ? '✓' : ''}</div>
          <div class="card-tile-issuer">${card.issuer}</div>
          <div class="card-tile-name">${card.name}</div>
          <div class="card-tile-fee ${feeClass}">${feeText}</div>
        </div>
      `;
        }).join('');

        // Attach click handlers
        container.querySelectorAll('.card-tile').forEach(tile => {
            tile.addEventListener('click', () => {
                tile.classList.toggle('selected');
                const check = tile.querySelector('.card-tile-check');
                check.textContent = tile.classList.contains('selected') ? '✓' : '';
            });
        });
    }

    _getSelectedFromGrid(container) {
        return Array.from(container.querySelectorAll('.card-tile.selected'))
            .map(el => el.dataset.cardId);
    }
}

// ======================================================
// SpendOptima — Main Entry Point
// ======================================================

import { WalletManager } from './modules/wallet.js';
import { SearchEngine } from './modules/search.js';
import { Calculator } from './modules/calculator.js';
import { ResultsRenderer } from './modules/results.js';
import { Router } from './modules/router.js';
import { FlightMaximizer, FlightResultsRenderer } from './modules/flights.js';
import './styles/index.css';

let data = null;
let wallet = null;
let search = null;
let calculator = null;
let results = null;
let router = null;
let flightMax = null;
let flightRenderer = null;
let currentMode = 'merchant';

async function init() {
    // Fetch master rules
    try {
        const response = await fetch('/master_rules.json');
        data = await response.json();
    } catch (err) {
        console.error('Failed to load master_rules.json:', err);
        return;
    }

    // Initialize modules
    wallet = new WalletManager();
    calculator = new Calculator(data);
    results = new ResultsRenderer(wallet);
    flightMax = new FlightMaximizer(data, wallet);
    flightRenderer = new FlightResultsRenderer();

    // Search — on merchant selection, calculate
    search = new SearchEngine(data, (searchItem, amount) => {
        const walletCards = wallet.getCards();
        const calcResult = calculator.calculate(searchItem, amount, walletCards);
        results.render(calcResult);

        // Update URL
        if (searchItem.type === 'merchant') {
            const slug = searchItem.name.toLowerCase().replace(/\s+/g, '-');
            history.replaceState(null, '', `#/merchant/${slug}`);
        }
    });

    // Wallet change listener
    wallet.onChange(() => {
        wallet.updatePillCount();
    });
    wallet.updatePillCount();

    // Wallet pill click
    document.getElementById('walletPill').addEventListener('click', () => {
        wallet.renderWalletModal(data.cards);
    });

    // ---- Mode Tabs ----
    setupModeTabs();

    // ---- Flight Maximizer ----
    setupFlightModule();

    // Router
    router = new Router();

    router.on('#/', () => {
        // Home page
        results.hide();
        flightRenderer.hide();
        document.getElementById('merchantPage').classList.add('hidden');
        const heroSection = document.getElementById('heroSection');
        heroSection.querySelector('.hero-title').style.display = '';
        heroSection.querySelector('.hero-subtitle').style.display = '';
        document.title = 'SpendOptima — Maximize Your Credit Card Rewards';
    });

    router.on('#/merchant/:name', (params) => {
        const merchantSlug = params.name;
        // Convert slug back to name
        const merchantName = findMerchantBySlug(merchantSlug);

        if (merchantName) {
            document.title = `Best Credit Card for ${merchantName} — SpendOptima`;
            // Switch to merchant mode
            switchMode('merchant');
            search.searchFor(merchantName, 1000);
        } else {
            // Unknown merchant — show hero
            router.navigate('#/');
        }
    });

    router.start();

    // Show onboarding modal on first visit
    if (wallet.isFirstVisit()) {
        setTimeout(() => {
            wallet.renderOnboardingModal(data.cards);
        }, 500);
    }

    // Register service worker for offline mode
    registerServiceWorker();
}

// ---- Mode Tab Logic ----
function setupModeTabs() {
    const tabs = document.querySelectorAll('.mode-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const mode = tab.dataset.mode;
            switchMode(mode);
        });
    });
}

function switchMode(mode) {
    currentMode = mode;
    const tabs = document.querySelectorAll('.mode-tab');
    tabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));

    const heroSection = document.getElementById('heroSection');
    const flightsSection = document.getElementById('flightsSection');
    const resultsSection = document.getElementById('resultsSection');

    if (mode === 'flights') {
        heroSection.classList.add('hidden');
        flightsSection.classList.remove('hidden');
        resultsSection.classList.add('hidden');
    } else {
        heroSection.classList.remove('hidden');
        flightsSection.classList.add('hidden');
        // Don't show results unless they already have content
    }
}

// ---- Flight Module Setup ----
function setupFlightModule() {
    const airlineInput = document.getElementById('airlineInput');
    const airlineSuggestions = document.getElementById('airlineSuggestions');
    const flightCalcBtn = document.getElementById('flightCalcBtn');
    let selectedAirline = null;
    let airlineResults = [];
    let selectedAirlineIndex = -1;

    // Airline fuzzy search using built-in Fuse
    const airlineFuse = new Fuse(flightMax.airlineSearchItems, {
        keys: [
            { name: 'name', weight: 2 },
            { name: 'keywords', weight: 1 },
            { name: 'program', weight: 0.8 }
        ],
        threshold: 0.4,
        includeScore: true
    });

    airlineInput.addEventListener('input', () => {
        const query = airlineInput.value.trim();
        if (query.length < 2) {
            airlineSuggestions.classList.remove('visible');
            airlineSuggestions.style.display = 'none';
            return;
        }

        airlineResults = airlineFuse.search(query).slice(0, 6);
        selectedAirlineIndex = -1;

        if (airlineResults.length === 0) {
            airlineSuggestions.classList.remove('visible');
            airlineSuggestions.style.display = 'none';
            return;
        }

        airlineSuggestions.innerHTML = airlineResults.map((r, i) => `
            <div class="suggestion-item ${i === selectedAirlineIndex ? 'active' : ''}" data-index="${i}">
                <span class="suggestion-name">${r.item.name}</span>
                <span class="suggestion-category">${r.item.program}</span>
            </div>
        `).join('');

        airlineSuggestions.style.display = 'block';
        airlineSuggestions.classList.add('visible');

        // Click on suggestion
        airlineSuggestions.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                const idx = parseInt(item.dataset.index);
                selectAirline(airlineResults[idx].item);
            });
        });
    });

    // Keyboard nav for airline suggestions
    airlineInput.addEventListener('keydown', (e) => {
        if (!airlineResults.length) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedAirlineIndex = Math.min(selectedAirlineIndex + 1, airlineResults.length - 1);
            updateAirlineSuggestionHighlight();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedAirlineIndex = Math.max(selectedAirlineIndex - 1, 0);
            updateAirlineSuggestionHighlight();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedAirlineIndex >= 0) {
                selectAirline(airlineResults[selectedAirlineIndex].item);
            }
        }
    });

    function updateAirlineSuggestionHighlight() {
        airlineSuggestions.querySelectorAll('.suggestion-item').forEach((item, i) => {
            item.classList.toggle('active', i === selectedAirlineIndex);
        });
    }

    function selectAirline(item) {
        selectedAirline = item;
        airlineInput.value = item.name;
        airlineSuggestions.classList.remove('visible');
        airlineSuggestions.style.display = 'none';

        // Focus the cost input
        document.getElementById('flightCostInput').focus();
    }

    // Calculate button
    flightCalcBtn.addEventListener('click', () => runFlightCalc());

    // Enter key on inputs
    document.getElementById('flightCostInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') runFlightCalc();
    });
    document.getElementById('milesInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') runFlightCalc();
    });

    function runFlightCalc() {
        if (!selectedAirline) {
            airlineInput.focus();
            return;
        }

        const ticketCost = parseInt(document.getElementById('flightCostInput').value) || 0;
        if (ticketCost <= 0) {
            document.getElementById('flightCostInput').focus();
            return;
        }

        const milesRequired = parseInt(document.getElementById('milesInput').value) || null;

        const calcResult = flightMax.calculate(selectedAirline.id, ticketCost, milesRequired);
        const partnerLookup = flightMax.getTransferPartners(selectedAirline.id);

        flightRenderer.render(calcResult, partnerLookup);
    }

    // Close suggestions on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.flight-airline-field')) {
            airlineSuggestions.classList.remove('visible');
            airlineSuggestions.style.display = 'none';
        }
    });
}

function findMerchantBySlug(slug) {
    const merchants = Object.keys(data.merchant_categories);
    return merchants.find(m => m.toLowerCase().replace(/\s+/g, '-') === slug.toLowerCase()) || null;
}

async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            await navigator.serviceWorker.register('/sw.js');
            console.log('Service Worker registered');
        } catch (err) {
            console.log('Service Worker registration failed:', err);
        }
    }
}

// Boot
document.addEventListener('DOMContentLoaded', init);

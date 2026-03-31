(function() {
    // ==================== VARIABLES GLOBALES ====================
    let currentUser = null;
    let currentRole = null; // 'client' ou 'driver'
    let activeRideId = null;
    let activeRideListener = null;
    let pendingRidesListener = null;
    let currentDriverRide = null;
    let pendingRideListener = null;
    let driverMessagesUnsubscribe = null;
    let previousPendingCount = 0; // pour la notification sonore

    let driverPosition = null;
    let driverWatchId = null;

    const auth = firebase.auth();
    const db = firebase.firestore();

    const rideLdrive = {
        id: 'ldrive',
        name: 'Ldrive',
        capacity: 4,
        baseFare: 1.2,
        perKm: 0.9,
        etaMinutes: 5,
        icon: '🚗'
    };

    // ==================== GOOGLE SHEETS WEB APP ====================
    const GOOGLE_SHEETS_URL = 'https://script.google.com/macros/s/AKfycbxEGKDH_UCdSTmrpoGSCyt8ihkFYyc62kLfgEdDuzxIGQzdtAl0dFYp4l5H_uQd39J_tA/exec'; // REMPLACEZ PAR VOTRE URL

    // Icônes Leaflet personnalisées
    const redIcon = L.icon({
        iconUrl: 'https://cdn.rawgit.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });

    const orangeIcon = L.icon({
        iconUrl: 'https://cdn.rawgit.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });

    const blueIcon = L.icon({
        iconUrl: 'https://cdn.rawgit.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });

    // Éléments DOM
    let clientTabs, driverTabs,
        ridesTab, trackingTab, activityTab, accountTab,
        driverRequestsTab, driverActiveTab, driverHistoryTab, driverAccountTab,
        pickupInput, dropoffInput, useLocationBtn, confirmBtn, rideCardDiv,
        nowBtn, laterBtn, datetimePicker, scheduleDatetime,
        modal, modalDetails, closeModal, modalCloseBtn,
        statusText, driverNameSpan, vehicleInfoSpan, etaSpan,
        completeBtn, cancelRideBtn,
        chatMessagesDiv, chatInput, chatSendBtn,
        pendingRidesListDiv,
        driverClientNameSpan, driverRouteSpan, driverStatusText,
        driverChatMessagesDiv, driverChatInput, driverChatSendBtn,
        driverGoToPickupBtn, driverStartBtn, driverCompleteBtn, driverCancelBtn,
        driverHistoryListDiv,
        roleDisplayDiv,
        bookingDiv, waitingDiv,
        paymentModal, paymentAmountSpan, payStripeBtn, payPaypalBtn, payGooglepayBtn, payApplepayBtn, paymentErrorDiv,
        authPanel,
        installBtn,
        logoutBtn;

    // ==================== MAP & LOCATION ====================
    let map, pickupMarker, dropoffMarker;
    let trackingMap, driverTrackingMap;
    let pickupCoords = null, dropoffCoords = null;

    // ==================== UTILITAIRES UI ====================
    function showLoading() {
        const spinner = document.getElementById('loading-spinner');
        if (spinner) spinner.style.display = 'flex';
    }
    function hideLoading() {
        const spinner = document.getElementById('loading-spinner');
        if (spinner) spinner.style.display = 'none';
    }
    function showToast(message, duration = 3000) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerText = message;
        container.appendChild(toast);
        toast.offsetHeight;
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 300);
        }, duration);
    }

    // ==================== GOOGLE SHEETS SYNC ====================
async function sendToGoogleSheets(rideData) {
    if (!GOOGLE_SHEETS_URL || GOOGLE_SHEETS_URL === 'https://script.google.com/macros/s/AKfycbxEGKDH_UCdSTmrpoGSCyt8ihkFYyc62kLfgEdDuzxIGQzdtAl0dFYp4l5H_uQd39J_tA/exec') {
        console.log('Google Sheets URL non configurée');
        return;
    }
    
    const formData = new URLSearchParams();
    for (const [key, value] of Object.entries(rideData)) {
        formData.append(key, value);
    }
    
    try {
        const response = await fetch(GOOGLE_SHEETS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData.toString()
        });
        const result = await response.json();
        console.log('Réponse Google Sheets:', result);
    } catch (error) {
        console.error('Erreur:', error);
    }
}

    // ==================== NOTIFICATION SONORE ====================
    function playNotificationSound() {
        try {
            const audio = new Audio('https://www.soundjay.com/misc/sounds/bell-ringing-05.mp3');
            audio.volume = 0.5;
            audio.play().catch(e => console.log('Audio playback failed:', e));
        } catch (e) {
            console.log('Audio not supported');
        }
    }

    // ==================== AUTOCOMPLÉTION POUR LES ADRESSES ====================
    async function initAddressAutocomplete(inputElement, setCoordsCallback) {
        if (!inputElement) return;

        let debounceTimer;
        let currentSuggestions = [];

        let suggestionContainer = inputElement.parentNode.querySelector('.autocomplete-suggestions');
        if (!suggestionContainer) {
            suggestionContainer = document.createElement('div');
            suggestionContainer.className = 'autocomplete-suggestions';
            inputElement.parentNode.style.position = 'relative';
            inputElement.parentNode.appendChild(suggestionContainer);
        }

        inputElement.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            if (query.length < 3) {
                suggestionContainer.innerHTML = '';
                suggestionContainer.style.display = 'none';
                return;
            }

            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                try {
                    const response = await fetch(
                        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`
                    );
                    const data = await response.json();
                    currentSuggestions = data;

                    if (data.length === 0) {
                        suggestionContainer.innerHTML = '<div class="suggestion-item no-result">Aucun résultat</div>';
                        suggestionContainer.style.display = 'block';
                        return;
                    }

                    suggestionContainer.innerHTML = data.map(place => `
                        <div class="suggestion-item" data-lat="${place.lat}" data-lon="${place.lon}" data-display="${escapeHtml(place.display_name)}">
                            ${escapeHtml(place.display_name)}
                        </div>
                    `).join('');
                    suggestionContainer.style.display = 'block';

                    document.querySelectorAll('.suggestion-item').forEach(item => {
                        item.addEventListener('click', () => {
                            const lat = parseFloat(item.dataset.lat);
                            const lon = parseFloat(item.dataset.lon);
                            const displayName = item.dataset.display;
                            inputElement.value = displayName;
                            suggestionContainer.innerHTML = '';
                            suggestionContainer.style.display = 'none';
                            setCoordsCallback({ lat, lng: lon });
                        });
                    });
                } catch (error) {
                    console.error('Erreur autocomplétion:', error);
                }
            }, 300);
        });

        document.addEventListener('click', (e) => {
            if (!inputElement.contains(e.target) && !suggestionContainer.contains(e.target)) {
                suggestionContainer.innerHTML = '';
                suggestionContainer.style.display = 'none';
            }
        });
    }

    // ==================== MAP & LOCATION (fonctions) ====================
    function initMap() {
        if (map) return;
        const mapElement = document.getElementById('map');
        if (!mapElement) return;

        map = L.map('map').setView([50.8503, 4.3517], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);

        requestUserLocation();

        pickupMarker = L.marker([50.8503, 4.3517], { draggable: true, icon: orangeIcon }).addTo(map);
        dropoffMarker = L.marker([50.8503, 4.3517 + 0.02], { draggable: true, icon: blueIcon }).addTo(map);

        pickupMarker.on('dragend', (e) => {
            const latlng = e.target.getLatLng();
            pickupCoords = { lat: latlng.lat, lng: latlng.lng };
            updateAddressFromCoords(pickupCoords, pickupInput);
            updateRidePrice();
        });
        dropoffMarker.on('dragend', (e) => {
            const latlng = e.target.getLatLng();
            dropoffCoords = { lat: latlng.lat, lng: latlng.lng };
            updateAddressFromCoords(dropoffCoords, dropoffInput);
            updateRidePrice();
        });
        map.on('click', (e) => {
            if (!dropoffCoords) {
                dropoffCoords = e.latlng;
                dropoffMarker.setLatLng(e.latlng);
                updateAddressFromCoords(dropoffCoords, dropoffInput);
                updateRidePrice();
            }
        });
    }

    function requestUserLocation() {
        if (!navigator.geolocation) {
            showToast('Géolocalisation non supportée par votre navigateur.', 5000);
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                map.setView([lat, lng], 14);
                L.marker([lat, lng], { icon: redIcon }).addTo(map).bindPopup('Vous êtes ici').openPopup();
                showToast('Position détectée !', 2000);
            },
            (error) => {
                let message = '';
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        message = 'Veuillez activer la géolocalisation pour centrer la carte.';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        message = 'Position non disponible.';
                        break;
                    case error.TIMEOUT:
                        message = 'Délai dépassé.';
                        break;
                    default:
                        message = 'Erreur de géolocalisation.';
                }
                showToast(message + ' Carte centrée sur Bruxelles.', 5000);
            }
        );
    }

    function updateAddressFromCoords(coords, inputElement) {
        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${coords.lat}&lon=${coords.lng}&zoom=18&addressdetails=1`)
            .then(res => res.json())
            .then(data => {
                if (data.display_name) inputElement.value = data.display_name;
            })
            .catch(() => {});
    }

    function geocodeAddress(address, callback) {
        fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`)
            .then(res => res.json())
            .then(data => {
                if (data && data[0]) {
                    const { lat, lon } = data[0];
                    callback({ lat: parseFloat(lat), lng: parseFloat(lon) });
                } else callback(null);
            })
            .catch(() => callback(null));
    }

    function getDistance(coord1, coord2) {
        const R = 6371;
        const dLat = (coord2.lat - coord1.lat) * Math.PI / 180;
        const dLon = (coord2.lng - coord1.lng) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(coord1.lat * Math.PI/180) * Math.cos(coord2.lat * Math.PI/180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    function updateRidePrice() {
        if (!pickupCoords || !dropoffCoords) {
            rideCardDiv.innerHTML = '<p>Veuillez sélectionner une prise en charge et une destination.</p>';
            confirmBtn.disabled = true;
            return;
        }
        const distance = getDistance(pickupCoords, dropoffCoords);
        if (distance < 0.1) {
            rideCardDiv.innerHTML = '<p>Distance trop courte, veuillez choisir une destination valide.</p>';
            confirmBtn.disabled = true;
            return;
        }
        const price = (rideLdrive.baseFare + rideLdrive.perKm * distance).toFixed(2);
        const eta = Math.max(3, Math.round(distance / 30 * 60) + rideLdrive.etaMinutes);
        rideCardDiv.innerHTML = `
            <div class="ride-card selected">
                <div class="ride-info">
                    <h4>${rideLdrive.icon} ${rideLdrive.name}</h4>
                    <p>${rideLdrive.capacity} places • ${eta} min d'attente</p>
                </div>
                <div class="ride-price">${price} €</div>
            </div>
        `;
        confirmBtn.disabled = false;
        window.currentDistance = distance;
        window.currentPrice = price;
        window.currentEta = eta;
    }

    function resetClientBooking() {
        if (pickupInput) pickupInput.value = '';
        if (dropoffInput) dropoffInput.value = '';
        pickupCoords = null;
        dropoffCoords = null;
        updateRidePrice();
        if (map) {
            map.setView([50.8503, 4.3517], 13);
            if (pickupMarker) pickupMarker.setLatLng([50.8503, 4.3517]);
            if (dropoffMarker) dropoffMarker.setLatLng([50.8503, 4.3517 + 0.02]);
        }
    }

    // ==================== POSITION CONDUCTEUR ====================
    function startDriverLocationTracking() {
        if (navigator.geolocation && driverWatchId === null) {
            driverWatchId = navigator.geolocation.watchPosition(
                (position) => {
                    driverPosition = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    };
                    if (driverTrackingMap && driverTrackingMap.driverMarker) {
                        driverTrackingMap.driverMarker.setLatLng([driverPosition.lat, driverPosition.lng]);
                        driverTrackingMap.setView([driverPosition.lat, driverPosition.lng]);
                    }
                },
                (error) => {
                    console.error('Erreur de géolocalisation:', error);
                },
                { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 }
            );
        }
    }

    function stopDriverLocationTracking() {
        if (driverWatchId !== null) {
            navigator.geolocation.clearWatch(driverWatchId);
            driverWatchId = null;
        }
    }

    // ==================== AFFICHAGE BOUTON DÉCONNEXION ====================
    function updateLogoutButton() {
        if (logoutBtn) {
            logoutBtn.style.display = currentUser ? 'flex' : 'none';
        }
    }

    // ==================== AUTHENTIFICATION & RÔLE ====================
    auth.onAuthStateChanged(async (user) => {
        currentUser = user;
        updateLogoutButton();
        if (user) {
            const userRef = db.collection('users').doc(user.uid);
            const userDoc = await userRef.get();
            if (userDoc.exists) {
                const role = userDoc.data().role;
                if (role === 'client' || role === 'driver') {
                    currentRole = role;
                    if (roleDisplayDiv) roleDisplayDiv.innerHTML = `<span class="role-badge">${role === 'client' ? '👩 Cliente' : '👩‍✈️ Conductrice'}</span>`;
                    if (authPanel) authPanel.style.display = 'none';
                    setRole(role);
                    return;
                } else {
                    await userRef.delete();
                }
            }
            showRoleChoiceForExistingUser(user);
        } else {
            currentRole = null;
            if (authPanel) {
                authPanel.style.display = 'block';
                if (clientTabs) clientTabs.style.display = 'none';
                if (driverTabs) driverTabs.style.display = 'none';
                const panes = document.querySelectorAll('.tab-pane');
                panes.forEach(pane => pane.classList.remove('active'));
            }
            showRoleChoice();
            stopDriverLocationTracking();
        }
    });

    function showRoleChoiceForExistingUser(user) {
        if (!authPanel) return;
        authPanel.innerHTML = `
            <div class="role-choice-container">
                <h2>Bienvenue ${user.displayName || user.email}</h2>
                <p>Choisissez votre profil :</p>
                <div class="role-choice-buttons">
                    <button id="choose-client-existing" class="role-choice-btn">👩 Je suis une cliente</button>
                    <button id="choose-driver-existing" class="role-choice-btn">👩‍✈️ Je suis une conductrice</button>
                </div>
            </div>
        `;
        setTimeout(() => {
            const clientBtn = document.getElementById('choose-client-existing');
            const driverBtn = document.getElementById('choose-driver-existing');
            if (clientBtn) {
                clientBtn.addEventListener('click', async () => {
                    await db.collection('users').doc(user.uid).set({
                        name: user.displayName || user.email,
                        email: user.email,
                        phone: '',
                        role: 'client'
                    });
                    auth.onAuthStateChanged(() => {});
                });
            }
            if (driverBtn) {
                driverBtn.addEventListener('click', async () => {
                    await db.collection('users').doc(user.uid).set({
                        name: user.displayName || user.email,
                        email: user.email,
                        phone: '',
                        role: 'driver',
                        licenseVerified: true
                    });
                    auth.onAuthStateChanged(() => {});
                });
            }
        }, 50);
    }

    // ==================== FLUX D'AUTH SIMPLIFIÉ ====================
    function showRoleChoice() {
        if (!authPanel) return;
        authPanel.innerHTML = `
            <div class="role-choice-container">
                <h2>Bienvenue sur Ldrive</h2>
                <p>Choisissez votre profil :</p>
                <div class="role-choice-buttons">
                    <button id="choose-client" class="role-choice-btn">👩 Je suis une cliente</button>
                    <button id="choose-driver" class="role-choice-btn">👩‍✈️ Je suis une conductrice</button>
                </div>
            </div>
        `;
        const clientBtn = document.getElementById('choose-client');
        const driverBtn = document.getElementById('choose-driver');

        if (clientBtn) {
            clientBtn.addEventListener('click', () => showRoleAuthChoice('client'));
        }
        if (driverBtn) {
            driverBtn.addEventListener('click', () => showRoleAuthChoice('driver'));
        }
    }

    function showRoleAuthChoice(role) {
        if (!authPanel) return;
        authPanel.innerHTML = `
            <div class="role-choice-container">
                <h2>${role === 'client' ? 'Cliente' : 'Conductrice'}</h2>
                <div class="auth-choice-buttons">
                    <button id="auth-login-btn" class="auth-choice-btn">Se connecter</button>
                    <button id="auth-signup-btn" class="auth-choice-btn">Créer un compte</button>
                </div>
            </div>
        `;
        const loginBtn = document.getElementById('auth-login-btn');
        const signupBtn = document.getElementById('auth-signup-btn');

        if (loginBtn) {
            loginBtn.addEventListener('click', () => showLoginForm(role));
        }
        if (signupBtn) {
            signupBtn.addEventListener('click', () => showSignupForm(role));
        }
    }

    function showLoginForm(role) {
        if (!authPanel) return;
        authPanel.innerHTML = `
            <div class="auth-form simple-form">
                <h3>Connexion ${role === 'client' ? 'cliente' : 'conductrice'}</h3>
                <input type="email" id="login-email" placeholder="Email">
                <input type="password" id="login-password" placeholder="Mot de passe">
                <button id="login-btn" class="confirm-btn">Se connecter</button>
                <div class="auth-divider">ou</div>
                <button id="google-login-btn" class="social-btn">🔐 Continuer avec Google</button>
                <p style="margin-top: 16px;">
                    <a href="#" id="back-to-choice" style="color:#b5838a;">← Retour</a>
                </p>
            </div>
        `;

        document.getElementById('back-to-choice').addEventListener('click', (e) => {
            e.preventDefault();
            showRoleAuthChoice(role);
        });

        document.getElementById('login-btn').addEventListener('click', async () => {
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            try {
                await auth.signInWithEmailAndPassword(email, password);
            } catch (error) {
                showToast('Email ou mot de passe incorrect');
            }
        });

        document.getElementById('google-login-btn').addEventListener('click', async () => {
            const provider = new firebase.auth.GoogleAuthProvider();
            try {
                const result = await auth.signInWithPopup(provider);
                const userRef = db.collection('users').doc(result.user.uid);
                const doc = await userRef.get();
                if (!doc.exists) {
                    await userRef.set({
                        name: result.user.displayName || result.user.email,
                        email: result.user.email,
                        phone: '',
                        role: role,
                        licenseVerified: (role === 'driver')
                    });
                } else {
                    const existingRole = doc.data().role;
                    if (existingRole !== role) {
                        showToast(`Ce compte est déjà enregistré comme ${existingRole}. Veuillez utiliser l'autre espace.`);
                        await auth.signOut();
                    }
                }
            } catch (error) {
                showToast('Erreur Google : ' + error.message);
            }
        });
    }

    function showSignupForm(role) {
        if (!authPanel) return;
        authPanel.innerHTML = `
            <div class="auth-form simple-form">
                <h3>Inscription ${role === 'client' ? 'cliente' : 'conductrice'}</h3>
                <input type="text" id="auth-name" placeholder="Nom complet">
                <input type="email" id="auth-email" placeholder="Email">
                <input type="tel" id="auth-phone" placeholder="Téléphone">
                <input type="password" id="auth-password" placeholder="Mot de passe">
                <button id="signup-btn" class="confirm-btn">Créer un compte</button>
                <div class="auth-divider">ou</div>
                <button id="google-signup-btn" class="social-btn">🔐 Continuer avec Google</button>
                <p style="margin-top: 16px;">
                    <a href="#" id="back-to-choice" style="color:#b5838a;">← Retour</a>
                </p>
            </div>
        `;

        document.getElementById('back-to-choice').addEventListener('click', (e) => {
            e.preventDefault();
            showRoleAuthChoice(role);
        });

        document.getElementById('signup-btn').addEventListener('click', async () => {
            const name = document.getElementById('auth-name').value;
            const email = document.getElementById('auth-email').value;
            const phone = document.getElementById('auth-phone').value;
            const password = document.getElementById('auth-password').value;
            if (!name || !email || !phone || !password) {
                showToast('Veuillez remplir tous les champs');
                return;
            }
            showLoading();
            try {
                const userCredential = await auth.createUserWithEmailAndPassword(email, password);
                await db.collection('users').doc(userCredential.user.uid).set({
                    name, email, phone, role: role,
                    licenseVerified: (role === 'driver')
                });
                showToast('Compte créé avec succès !');
            } catch (error) {
                showToast('Erreur : ' + error.message);
            } finally {
                hideLoading();
            }
        });

        document.getElementById('google-signup-btn').addEventListener('click', async () => {
            const provider = new firebase.auth.GoogleAuthProvider();
            try {
                const result = await auth.signInWithPopup(provider);
                const userRef = db.collection('users').doc(result.user.uid);
                const doc = await userRef.get();
                if (!doc.exists) {
                    await userRef.set({
                        name: result.user.displayName || result.user.email,
                        email: result.user.email,
                        phone: '',
                        role: role,
                        licenseVerified: (role === 'driver')
                    });
                    showToast('Compte créé avec succès !');
                } else {
                    const existingRole = doc.data().role;
                    if (existingRole !== role) {
                        showToast(`Ce compte est déjà enregistré comme ${existingRole}. Veuillez utiliser l'autre espace.`);
                        await auth.signOut();
                    }
                }
            } catch (error) {
                showToast('Erreur Google : ' + error.message);
            }
        });
    }

    // ==================== INTERFACES ====================
    function setRole(role) {
        if (role === 'client') {
            if (clientTabs) clientTabs.style.display = 'flex';
            if (driverTabs) driverTabs.style.display = 'none';
            ridesTab.style.display = '';
            trackingTab.style.display = '';
            activityTab.style.display = '';
            accountTab.style.display = '';
            showClientTab('rides');
            if (currentUser) {
                loadClientHistory();
                listenForActiveRide();
            }
            stopDriverLocationTracking();
        } else if (role === 'driver') {
            if (clientTabs) clientTabs.style.display = 'none';
            if (driverTabs) driverTabs.style.display = 'flex';
            ridesTab.style.display = 'none';
            trackingTab.style.display = 'none';
            activityTab.style.display = 'none';
            accountTab.style.display = 'none';
            showDriverTab('driver-requests');
            if (currentUser) {
                listenForPendingRides();
                listenForActiveRideDriver();
                loadDriverHistory();
            }
            startDriverLocationTracking();
        }
        document.body.offsetHeight;
        setTimeout(() => {
            if (role === 'client' && map === undefined) {
                initMap();
                if (map) map.invalidateSize();
            }
        }, 200);
    }

    function showClientTab(tabId) {
        if (!clientTabs) return;
        document.querySelectorAll('#client-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.querySelector(`#client-tabs .tab-btn[data-tab="${tabId}"]`);
        if (activeBtn) activeBtn.classList.add('active');
        document.querySelectorAll('#rides-tab, #tracking-tab, #activity-tab, #account-tab').forEach(pane => pane.classList.remove('active'));
        if (tabId === 'rides') ridesTab.classList.add('active');
        else if (tabId === 'tracking') trackingTab.classList.add('active');
        else if (tabId === 'activity') activityTab.classList.add('active');
        else if (tabId === 'account') accountTab.classList.add('active');
        if (tabId === 'rides' && map) setTimeout(() => map.invalidateSize(), 100);
        if (tabId === 'tracking' && trackingMap) setTimeout(() => trackingMap.invalidateSize(), 100);
    }

    function showDriverTab(tabId) {
        if (!driverTabs) return;
        document.querySelectorAll('#driver-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.querySelector(`#driver-tabs .tab-btn[data-tab="${tabId}"]`);
        if (activeBtn) activeBtn.classList.add('active');
        document.querySelectorAll('#driver-requests-tab, #driver-active-tab, #driver-history-tab, #driver-account-tab').forEach(pane => pane.classList.remove('active'));
        if (tabId === 'driver-requests') driverRequestsTab.classList.add('active');
        else if (tabId === 'driver-active') driverActiveTab.classList.add('active');
        else if (tabId === 'driver-history') driverHistoryTab.classList.add('active');
        else if (tabId === 'driver-account') driverAccountTab.classList.add('active');
        if (tabId === 'driver-active' && driverTrackingMap) setTimeout(() => driverTrackingMap.invalidateSize(), 100);
    }

    // ==================== ÉCRAN D'ATTENTE ====================
    function showWaitingView(rideId) {
        if (bookingDiv) bookingDiv.style.display = 'none';
        if (waitingDiv) waitingDiv.style.display = 'block';

        const cancelBtn = document.getElementById('cancel-waiting-btn');
        if (cancelBtn) {
            cancelBtn.onclick = async () => {
                if (confirm('Annuler la demande de course ?')) {
                    showLoading();
                    try {
                        await db.collection('rides').doc(rideId).delete();
                        if (bookingDiv) bookingDiv.style.display = 'block';
                        if (waitingDiv) waitingDiv.style.display = 'none';
                        resetClientBooking();
                        showToast('Demande annulée.');
                    } catch (error) {
                        showToast('Erreur lors de l’annulation : ' + error.message);
                    } finally {
                        hideLoading();
                    }
                }
            };
        }

        let notificationShown = false;

        if (pendingRideListener) pendingRideListener();
        pendingRideListener = db.collection('rides').doc(rideId).onSnapshot((doc) => {
            if (doc.exists) {
                const ride = doc.data();
                if (ride.status === 'accepted' || ride.status === 'started') {
                    if (!notificationShown) {
                        notificationShown = true;
                        const driverName = ride.driverName || 'une conductrice';
                        showToast(`🎉 Votre course a été acceptée par ${driverName} !`, 5000);
                        if (window.navigator && window.navigator.vibrate) {
                            window.navigator.vibrate(200);
                        }
                    }
                    activeRideId = rideId;
                    displayClientTracking(ride, rideId);
                    showClientTab('tracking');
                    if (pendingRideListener) pendingRideListener();
                    if (bookingDiv) bookingDiv.style.display = 'block';
                    if (waitingDiv) waitingDiv.style.display = 'none';
                }
            } else {
                if (bookingDiv) bookingDiv.style.display = 'block';
                if (waitingDiv) waitingDiv.style.display = 'none';
                if (pendingRideListener) pendingRideListener();
            }
        });
    }

    // ==================== MODALE DE PAIEMENT ====================
    function showPaymentModal(rideId, amount) {
        if (!paymentModal) return;
        paymentAmountSpan.innerText = amount;
        paymentErrorDiv.innerText = '';
        paymentModal.style.display = 'flex';

        const handlePayment = async (method) => {
            showLoading();
            try {
                console.log(`Paiement via ${method} de ${amount}€`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                await db.collection('rides').doc(rideId).update({
                    paymentStatus: 'paid',
                    paymentMethod: method
                });
                paymentModal.style.display = 'none';
                showWaitingView(rideId);
            } catch (error) {
                paymentErrorDiv.innerText = 'Erreur de paiement : ' + error.message;
            } finally {
                hideLoading();
            }
        };

        payStripeBtn.onclick = () => handlePayment('stripe');
        payPaypalBtn.onclick = () => handlePayment('paypal');
        payGooglepayBtn.onclick = () => handlePayment('google_pay');
        payApplepayBtn.onclick = () => handlePayment('apple_pay');

        const closeSpan = paymentModal.querySelector('.close');
        closeSpan.onclick = () => paymentModal.style.display = 'none';
    }

    // ==================== CLIENT ====================
    async function listenForActiveRide() {
        if (activeRideListener) activeRideListener();
        const q = db.collection('rides')
            .where('clientId', '==', currentUser.uid)
            .where('status', 'in', ['accepted', 'started'])
            .limit(1);
        activeRideListener = q.onSnapshot((snapshot) => {
            if (!snapshot.empty) {
                const ride = snapshot.docs[0].data();
                activeRideId = snapshot.docs[0].id;
                displayClientTracking(ride, activeRideId);
                showClientTab('tracking');
            } else {
                activeRideId = null;
                if (currentRole === 'client') {
                    resetClientBooking();
                    showClientTab('rides');
                }
            }
        });
    }

    function displayClientTracking(ride, rideId) {
        statusText.innerText = ride.status === 'accepted' ? 'Conductrice en route' : 'Course en cours';
        driverNameSpan.innerText = ride.driverName || 'En attente';
        vehicleInfoSpan.innerText = ride.vehicle || '---';
        etaSpan.innerText = ride.eta + ' min';

        if (trackingMap) trackingMap.remove();
        trackingMap = L.map('tracking-map').setView([ride.pickupCoords.lat, ride.pickupCoords.lng], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(trackingMap);
        L.marker([ride.pickupCoords.lat, ride.pickupCoords.lng], { icon: orangeIcon }).addTo(trackingMap).bindPopup('Prise en charge');
        L.marker([ride.dropoffCoords.lat, ride.dropoffCoords.lng], { icon: blueIcon }).addTo(trackingMap).bindPopup('Destination');

        loadMessages(rideId, 'client');
    }

    async function loadMessages(rideId, role) {
        if (role === 'driver' && driverMessagesUnsubscribe) {
            driverMessagesUnsubscribe();
            driverMessagesUnsubscribe = null;
        }

        const q = db.collection('rides').doc(rideId).collection('messages').orderBy('timestamp');
        const unsubscribe = q.onSnapshot((snapshot) => {
            const container = role === 'client' ? chatMessagesDiv : driverChatMessagesDiv;
            if (!container) return;
            container.innerHTML = '';
            snapshot.forEach(docSnap => {
                const msg = docSnap.data();
                addMessageToChat(msg.text, msg.sender === role ? 'sent' : 'received', new Date(msg.timestamp).toLocaleTimeString(), container);
            });
        });
        if (role === 'driver') {
            driverMessagesUnsubscribe = unsubscribe;
        }
    }

    async function sendMessage(rideId, text, senderRole) {
        if (!text.trim()) return;
        const message = {
            text: text,
            sender: senderRole,
            timestamp: new Date().toISOString()
        };
        await db.collection('rides').doc(rideId).collection('messages').add(message);
    }

    function addMessageToChat(text, type, time, container) {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', type);
        msgDiv.innerHTML = `
            <div class="message-bubble">${escapeHtml(text)}</div>
            <div class="message-time">${time}</div>
        `;
        container.appendChild(msgDiv);
        container.scrollTop = container.scrollHeight;
    }

    async function loadClientHistory() {
        if (!currentUser) return;
        const historyDiv = document.getElementById('rides-history');
        if (!historyDiv) return;

        try {
            const q = db.collection('rides')
                .where('clientId', '==', currentUser.uid)
                .where('status', 'in', ['completed', 'cancelled']);
            const snapshot = await q.get();

            if (snapshot.empty) {
                historyDiv.innerHTML = '<p>Aucune course pour le moment.</p>';
                return;
            }

            const rides = [];
            snapshot.forEach(doc => {
                rides.push({ id: doc.id, ...doc.data() });
            });
            rides.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            let html = '';
            rides.forEach(ride => {
                const driverName = ride.driverName || 'Conductrice inconnue';
                const rideTitle = ride.status === 'completed' ? `${driverName}` : 'Course annulée';

                let starsHtml = '';
                if (ride.status === 'completed') {
                    const currentRating = ride.clientRating || 0;
                    starsHtml = `
                        <div class="rating-container" data-ride-id="${ride.id}" data-rated="${currentRating > 0}">
                            <div class="star-rating">
                                ${[1, 2, 3, 4, 5].map(value => `
                                    <span class="star ${value <= currentRating ? 'filled' : ''}" data-value="${value}">★</span>
                                `).join('')}
                            </div>
                            ${currentRating > 0 ? '<small class="rated-text">Merci pour votre évaluation !</small>' : '<small class="rate-prompt">Évaluez cette course</small>'}
                        </div>
                    `;
                }

                html += `
                    <div class="history-item" data-ride-id="${ride.id}">
                        <div class="history-details">
                            <p><strong>${rideTitle}</strong> - ${ride.price} €</p>
                            <p>${ride.pickup} → ${ride.dropoff}</p>
                            <small>${new Date(ride.createdAt).toLocaleString()}</small>
                            <p>Statut : ${ride.status}</p>
                        </div>
                        ${starsHtml}
                    </div>
                `;
            });
            historyDiv.innerHTML = html;

            document.querySelectorAll('.rating-container[data-rated="false"] .star').forEach(star => {
                star.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const rating = parseInt(star.dataset.value);
                    const container = star.closest('.rating-container');
                    const rideId = container.dataset.rideId;
                    await rateRide(rideId, rating);
                    loadClientHistory();
                });
            });
        } catch (error) {
            console.error('Erreur lors du chargement de l’historique client :', error);
            historyDiv.innerHTML = '<p>Erreur de chargement. Vérifiez la console.</p>';
        }
    }

    async function rateRide(rideId, rating) {
        if (!currentUser) return;
        showLoading();
        try {
            await db.collection('rides').doc(rideId).update({
                clientRating: rating,
                ratedAt: new Date().toISOString()
            });
            showToast(`Note de ${rating} étoile${rating > 1 ? 's' : ''} enregistrée !`, 3000);
        } catch (error) {
            console.error('Erreur lors de l’enregistrement de la note :', error);
            showToast('Erreur : ' + error.message);
        } finally {
            hideLoading();
        }
    }

    // ==================== CONDUCTRICE ====================
    async function listenForPendingRides() {
        if (pendingRidesListener) pendingRidesListener();
        const q = db.collection('rides')
            .where('status', '==', 'pending')
            .where('paymentStatus', '==', 'paid');
        pendingRidesListener = q.onSnapshot((snapshot) => {
            const pendingList = [];
            snapshot.forEach(doc => {
                pendingList.push({ id: doc.id, ...doc.data() });
            });
            if (pendingList.length > previousPendingCount) {
                playNotificationSound();
            }
            previousPendingCount = pendingList.length;
            displayPendingRides(pendingList);
        });
    }

    function displayPendingRides(pendingList) {
        if (!pendingRidesListDiv) return;
        if (pendingList.length === 0) {
            pendingRidesListDiv.innerHTML = '<p>Aucune course en attente.</p>';
            return;
        }
        let html = '';
        pendingList.forEach(ride => {
            const mapId = `pending-map-${ride.id}`;
            html += `
                <div class="pending-ride-card" data-ride-id="${ride.id}">
                    <h4>${ride.clientName}</h4>
                    <p>🚗 ${ride.pickup} → ${ride.dropoff}</p>
                    <p>💰 ${ride.price} € | ⏱️ ${ride.eta} min</p>
                    <div id="${mapId}" style="height: 150px; width: 100%; margin: 8px 0; border-radius: 12px;"></div>
                    <button class="accept-ride-btn" data-id="${ride.id}">Accepter la course</button>
                </div>
            `;
        });
        pendingRidesListDiv.innerHTML = html;

        pendingList.forEach(ride => {
            const mapId = `pending-map-${ride.id}`;
            const mapContainer = document.getElementById(mapId);
            if (mapContainer) {
                const center = [ride.pickupCoords.lat, ride.pickupCoords.lng];
                const miniMap = L.map(mapId).setView(center, 13);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '&copy; OpenStreetMap contributors'
                }).addTo(miniMap);
                L.marker([ride.pickupCoords.lat, ride.pickupCoords.lng], { icon: orangeIcon }).addTo(miniMap).bindPopup('Départ');
                L.marker([ride.dropoffCoords.lat, ride.dropoffCoords.lng], { icon: blueIcon }).addTo(miniMap).bindPopup('Destination');
                L.polyline([[ride.pickupCoords.lat, ride.pickupCoords.lng], [ride.dropoffCoords.lat, ride.dropoffCoords.lng]], { color: '#b5838a', weight: 3 }).addTo(miniMap);
                if (driverPosition) {
                    L.marker([driverPosition.lat, driverPosition.lng], {
                        icon: L.divIcon({ html: '🚗', className: 'driver-marker-small', iconSize: [20, 20] })
                    }).addTo(miniMap).bindPopup('Votre position');
                }
            }
        });

        document.querySelectorAll('.accept-ride-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const rideId = btn.dataset.id;
                await acceptRide(rideId);
            });
        });
    }

    async function acceptRide(rideId) {
        showLoading();
        try {
            await db.collection('rides').doc(rideId).update({
                status: 'accepted',
                driverId: currentUser.uid,
                driverName: currentUser.displayName || currentUser.email,
                vehicle: 'Renault Zoé'
            });
            
            // Envoyer la mise à jour à Google Sheets
            const rideDoc = await db.collection('rides').doc(rideId).get();
            const ride = rideDoc.data();
            sendToGoogleSheets({
                id: rideId,
                driverName: currentUser.displayName || currentUser.email,
                status: 'accepted',
                updatedAt: new Date().toISOString()
            });
            
            showToast('Course acceptée ! Vous pouvez suivre le trajet.');
        } catch (error) {
            showToast('Erreur lors de l’acceptation : ' + error.message);
        } finally {
            hideLoading();
        }
    }

    async function listenForActiveRideDriver() {
        if (activeRideListener) activeRideListener();
        const q = db.collection('rides')
            .where('driverId', '==', currentUser.uid)
            .where('status', 'in', ['accepted', 'started']);
        activeRideListener = q.onSnapshot((snapshot) => {
            if (!snapshot.empty) {
                const ride = snapshot.docs[0].data();
                activeRideId = snapshot.docs[0].id;
                currentDriverRide = ride;
                displayDriverActiveRide(ride, activeRideId);
                showDriverTab('driver-active');
            } else {
                activeRideId = null;
                currentDriverRide = null;
                if (currentRole === 'driver') showDriverTab('driver-requests');
            }
        });
    }

    function displayDriverActiveRide(ride, rideId) {
        driverClientNameSpan.innerText = ride.clientName;
        driverRouteSpan.innerText = `${ride.pickup} → ${ride.dropoff}`;
        driverStatusText.innerText = ride.status === 'accepted' ? 'En route vers la cliente' : 'Course en cours';

        if (driverTrackingMap) driverTrackingMap.remove();
        const center = driverPosition ? [driverPosition.lat, driverPosition.lng] : [ride.pickupCoords.lat, ride.pickupCoords.lng];
        driverTrackingMap = L.map('driver-tracking-map').setView(center, 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(driverTrackingMap);
        L.marker([ride.pickupCoords.lat, ride.pickupCoords.lng], { icon: orangeIcon }).addTo(driverTrackingMap).bindPopup('Prise en charge');
        L.marker([ride.dropoffCoords.lat, ride.dropoffCoords.lng], { icon: blueIcon }).addTo(driverTrackingMap).bindPopup('Destination');
        L.polyline([[ride.pickupCoords.lat, ride.pickupCoords.lng], [ride.dropoffCoords.lat, ride.dropoffCoords.lng]], { color: '#b5838a', weight: 3 }).addTo(driverTrackingMap);
        if (driverPosition) {
            const driverMarker = L.marker([driverPosition.lat, driverPosition.lng], { icon: L.divIcon({ html: '🚗', className: 'driver-marker', iconSize: [30, 30] }) }).addTo(driverTrackingMap);
            driverTrackingMap.driverMarker = driverMarker;
        } else {
            driverTrackingMap.driverMarker = null;
        }

        setTimeout(() => {
            loadMessages(rideId, 'driver');
        }, 100);
    }

    async function loadDriverHistory() {
        if (!currentUser) return;
        try {
            const q = db.collection('rides')
                .where('driverId', '==', currentUser.uid)
                .where('status', 'in', ['completed', 'cancelled']);
            const snapshot = await q.get();
            if (!driverHistoryListDiv) return;
            if (snapshot.empty) {
                driverHistoryListDiv.innerHTML = '<p>Aucune course pour le moment.</p>';
                return;
            }
            const rides = [];
            snapshot.forEach(doc => {
                rides.push({ id: doc.id, ...doc.data() });
            });
            rides.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            let html = '';
            rides.forEach(ride => {
                html += `
                    <div class="history-item">
                        <div class="history-details">
                            <p><strong>Cliente :</strong> ${ride.clientName}</p>
                            <p>${ride.pickup} → ${ride.dropoff}</p>
                            <p><strong>Prix :</strong> ${ride.price} €</p>
                            <small>${new Date(ride.createdAt).toLocaleString()}</small>
                            <p>Statut : ${ride.status}</p>
                            ${ride.clientRating ? `<p>Note de la cliente : ${ride.clientRating} ★</p>` : ''}
                        </div>
                    </div>
                `;
            });
            driverHistoryListDiv.innerHTML = html;
        } catch (error) {
            console.error('Error loading driver history:', error);
            if (driverHistoryListDiv) driverHistoryListDiv.innerHTML = '<p>Erreur lors du chargement de l’historique. Vérifiez la console.</p>';
        }
    }

    // ==================== AFFICHAGE PROFIL ====================
    function showProfile() {
        const authSection = document.getElementById('auth-section');
        if (!authSection) return;
        authSection.innerHTML = `
            <div style="text-align:center">
                <h3>👩 ${currentUser.displayName || currentUser.email}</h3>
                <p>${currentUser.email}</p>
                <button id="logout-btn" style="background:black;color:white;border:none;padding:10px 20px;border-radius:40px;">Se déconnecter</button>
                <p style="margin-top: 20px;">
                    <a href="privacy.html" target="_blank">Politique de confidentialité</a> | 
                    <a href="terms.html" target="_blank">Conditions d'utilisation</a>
                </p>
            </div>
        `;
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) logoutBtn.addEventListener('click', () => auth.signOut());
    }

    async function showDriverProfile() {
        const authSection = document.getElementById('driver-auth-section');
        if (!authSection) return;
        const userDoc = await db.collection('users').doc(currentUser.uid).get();
        const userData = userDoc.data();
        let html = `
            <div style="text-align:center">
                <h3>👩‍✈️ ${userData.name || currentUser.displayName || currentUser.email}</h3>
                <p>${currentUser.email}</p>
                <button id="driver-logout-btn" style="background:black;color:white;border:none;padding:10px 20px;border-radius:40px;">Se déconnecter</button>
                <p style="margin-top: 20px;">
                    <a href="privacy.html" target="_blank">Politique de confidentialité</a> | 
                    <a href="terms.html" target="_blank">Conditions d'utilisation</a>
                </p>
            </div>
        `;
        authSection.innerHTML = html;

        const logoutBtn = document.getElementById('driver-logout-btn');
        if (logoutBtn) logoutBtn.addEventListener('click', () => auth.signOut());
    }

    // ==================== UTILITAIRES ====================
    function escapeHtml(str) {
        return str.replace(/[&<>]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }

    // ==================== INITIALISATION APRÈS CHARGEMENT ====================
    document.addEventListener('DOMContentLoaded', () => {
        // Récupération des éléments DOM
        clientTabs = document.getElementById('client-tabs');
        driverTabs = document.getElementById('driver-tabs');
        ridesTab = document.getElementById('rides-tab');
        trackingTab = document.getElementById('tracking-tab');
        activityTab = document.getElementById('activity-tab');
        accountTab = document.getElementById('account-tab');
        driverRequestsTab = document.getElementById('driver-requests-tab');
        driverActiveTab = document.getElementById('driver-active-tab');
        driverHistoryTab = document.getElementById('driver-history-tab');
        driverAccountTab = document.getElementById('driver-account-tab');
        pickupInput = document.getElementById('pickup-input');
        dropoffInput = document.getElementById('dropoff-input');
        useLocationBtn = document.getElementById('use-current-location');
        confirmBtn = document.getElementById('confirm-ride-btn');
        rideCardDiv = document.getElementById('ride-card');
        nowBtn = document.getElementById('now-btn');
        laterBtn = document.getElementById('later-btn');
        datetimePicker = document.getElementById('datetime-picker');
        scheduleDatetime = document.getElementById('schedule-datetime');
        modal = document.getElementById('confirmation-modal');
        modalDetails = document.getElementById('modal-details');
        closeModal = document.querySelector('.close');
        modalCloseBtn = document.getElementById('modal-close-btn');
        statusText = document.getElementById('status-text');
        driverNameSpan = document.getElementById('driver-name');
        vehicleInfoSpan = document.getElementById('vehicle-info');
        etaSpan = document.getElementById('eta');
        completeBtn = document.getElementById('complete-ride-btn');
        cancelRideBtn = document.getElementById('cancel-ride-btn');
        chatMessagesDiv = document.getElementById('chat-messages');
        chatInput = document.getElementById('chat-input');
        chatSendBtn = document.getElementById('chat-send-btn');
        pendingRidesListDiv = document.getElementById('pending-rides-list');
        driverClientNameSpan = document.getElementById('driver-client-name');
        driverRouteSpan = document.getElementById('driver-route');
        driverStatusText = document.getElementById('driver-status-text');
        driverChatMessagesDiv = document.getElementById('driver-chat-messages');
        driverChatInput = document.getElementById('driver-chat-input');
        driverChatSendBtn = document.getElementById('driver-chat-send-btn');
        driverGoToPickupBtn = document.getElementById('driver-go-to-pickup-btn');
        driverStartBtn = document.getElementById('driver-start-ride-btn');
        driverCompleteBtn = document.getElementById('driver-complete-ride-btn');
        driverCancelBtn = document.getElementById('driver-cancel-ride-btn');
        driverHistoryListDiv = document.getElementById('driver-history-list');
        roleDisplayDiv = document.getElementById('role-display');
        bookingDiv = document.getElementById('ride-booking');
        waitingDiv = document.getElementById('waiting-view');
        paymentModal = document.getElementById('payment-modal');
        paymentAmountSpan = document.getElementById('payment-amount');
        payStripeBtn = document.getElementById('pay-stripe-btn');
        payPaypalBtn = document.getElementById('pay-paypal-btn');
        payGooglepayBtn = document.getElementById('pay-googlepay-btn');
        payApplepayBtn = document.getElementById('pay-applepay-btn');
        paymentErrorDiv = document.getElementById('payment-error');
        authPanel = document.getElementById('auth-panel');
        installBtn = document.getElementById('install-app-btn');
        logoutBtn = document.getElementById('logout-btn-header');

        // ==================== GESTION DU BOUTON D'INSTALLATION ====================
        if (installBtn) {
            installBtn.style.display = 'flex';
        }

        let deferredPrompt;
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;
        });

        if (installBtn) {
            installBtn.addEventListener('click', async () => {
                if (deferredPrompt) {
                    deferredPrompt.prompt();
                    const { outcome } = await deferredPrompt.userChoice;
                    if (outcome === 'accepted') {
                        console.log('Installation acceptée');
                    }
                    deferredPrompt = null;
                } else {
                    showToast('Pour installer l’application, utilisez le menu de votre navigateur : "Ajouter à l’écran d’accueil".');
                }
            });
        }

        // ==================== GESTION DU BOUTON DE DÉCONNEXION ====================
        if (logoutBtn) {
            logoutBtn.addEventListener('click', async () => {
                showLoading();
                try {
                    await auth.signOut();
                    showToast('Déconnexion réussie');
                    setTimeout(() => {
                        window.location.reload();
                    }, 500);
                } catch (error) {
                    showToast('Erreur lors de la déconnexion : ' + error.message);
                } finally {
                    hideLoading();
                }
            });
        }

        // ==================== INITIALISATION DE L'AUTOCOMPLÉTION ====================
        initAddressAutocomplete(pickupInput, (coords) => {
            pickupCoords = coords;
            if (pickupMarker) pickupMarker.setLatLng([coords.lat, coords.lng]);
            if (map) map.setView([coords.lat, coords.lng], 14);
            updateRidePrice();
        });

        initAddressAutocomplete(dropoffInput, (coords) => {
            dropoffCoords = coords;
            if (dropoffMarker) dropoffMarker.setLatLng([coords.lat, coords.lng]);
            updateRidePrice();
        });

        // Localisation
        if (pickupInput) {
            pickupInput.addEventListener('change', () => {
                geocodeAddress(pickupInput.value, (coords) => {
                    if (coords) {
                        pickupCoords = coords;
                        if (pickupMarker) pickupMarker.setLatLng([coords.lat, coords.lng]);
                        if (map) map.setView([coords.lat, coords.lng], 14);
                        updateRidePrice();
                    }
                });
            });
        }
        if (dropoffInput) {
            dropoffInput.addEventListener('change', () => {
                geocodeAddress(dropoffInput.value, (coords) => {
                    if (coords) {
                        dropoffCoords = coords;
                        if (dropoffMarker) dropoffMarker.setLatLng([coords.lat, coords.lng]);
                        updateRidePrice();
                    }
                });
            });
        }
        if (useLocationBtn) {
            useLocationBtn.addEventListener('click', () => {
                if (navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(pos => {
                        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                        pickupCoords = coords;
                        if (pickupMarker) pickupMarker.setLatLng([coords.lat, coords.lng]);
                        if (map) map.setView([coords.lat, coords.lng], 15);
                        updateAddressFromCoords(coords, pickupInput);
                        updateRidePrice();
                    });
                }
            });
        }

        // Confirmer course
        if (confirmBtn) {
            confirmBtn.addEventListener('click', async () => {
                if (!pickupCoords || !dropoffCoords) {
                    showToast('Veuillez sélectionner une prise en charge et une destination.');
                    return;
                }
                if (!currentUser) {
                    showToast('Veuillez vous connecter pour réserver une course.');
                    return;
                }
                const distance = getDistance(pickupCoords, dropoffCoords);
                const price = (rideLdrive.baseFare + rideLdrive.perKm * distance).toFixed(2);
                const eta = Math.max(3, Math.round(distance / 30 * 60) + rideLdrive.etaMinutes);

                const rideData = {
                    clientId: currentUser.uid,
                    clientName: currentUser.displayName || currentUser.email,
                    pickup: pickupInput.value,
                    dropoff: dropoffInput.value,
                    pickupCoords: { lat: pickupCoords.lat, lng: pickupCoords.lng },
                    dropoffCoords: { lat: dropoffCoords.lat, lng: dropoffCoords.lng },
                    price: parseFloat(price),
                    eta: eta,
                    status: 'pending',
                    paymentStatus: 'pending',
                    paymentMethod: null,
                    driverId: null,
                    driverName: null,
                    vehicle: null,
                    messages: [],
                    createdAt: new Date().toISOString(),
                    scheduled: (laterBtn && laterBtn.classList.contains('active') && scheduleDatetime && scheduleDatetime.value) ? scheduleDatetime.value : null
                };
                showLoading();
                try {
                    const docRef = await db.collection('rides').add(rideData);
                    
                    // Envoyer à Google Sheets
                    sendToGoogleSheets({
                        id: docRef.id,
                        clientName: currentUser.displayName || currentUser.email,
                        pickup: pickupInput.value,
                        dropoff: dropoffInput.value,
                        price: parseFloat(price),
                        status: 'pending',
                        createdAt: new Date().toISOString(),
                        paymentMethod: null
                    });
                    
                    showPaymentModal(docRef.id, parseFloat(price));
                } catch (error) {
                    showToast('Erreur lors de la création de la course : ' + error.message);
                } finally {
                    hideLoading();
                }
            });
        }

        // Conductrice : messagerie et actions
        if (driverChatSendBtn) {
            driverChatSendBtn.addEventListener('click', () => {
                if (activeRideId) {
                    sendMessage(activeRideId, driverChatInput.value, 'driver');
                } else {
                    showToast('Aucune course active pour envoyer un message.');
                }
                driverChatInput.value = '';
            });
            driverChatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') driverChatSendBtn.click();
            });
        }

        if (driverGoToPickupBtn) {
            driverGoToPickupBtn.addEventListener('click', () => {
                if (!currentDriverRide) {
                    showToast('Aucune course active.');
                    return;
                }
                const { lat, lng } = currentDriverRide.pickupCoords;
                const wazeUrl = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
                window.open(wazeUrl, '_blank');
                showToast('Ouverture de Waze vers la cliente.');
            });
        }

        if (driverStartBtn) {
            driverStartBtn.addEventListener('click', async () => {
                if (!activeRideId || !currentDriverRide) {
                    showToast('Aucune course active.');
                    return;
                }
                if (currentDriverRide.status !== 'accepted') {
                    showToast('La course a déjà été démarrée.');
                    return;
                }
                const { lat, lng } = currentDriverRide.dropoffCoords;
                const wazeUrl = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
                window.open(wazeUrl, '_blank');
                showLoading();
                try {
                    await db.collection('rides').doc(activeRideId).update({ status: 'started' });
                    showToast('Course démarrée ! Waze ouvert vers la destination.');
                } catch (error) {
                    showToast('Erreur : ' + error.message);
                } finally {
                    hideLoading();
                }
            });
        }

        if (driverCompleteBtn) {
            driverCompleteBtn.addEventListener('click', async () => {
                if (activeRideId) {
                    showLoading();
                    try {
                        await db.collection('rides').doc(activeRideId).update({ status: 'completed' });
                        
                        // Envoyer la mise à jour à Google Sheets
                        sendToGoogleSheets({
                            id: activeRideId,
                            status: 'completed',
                            updatedAt: new Date().toISOString()
                        });
                        
                        activeRideId = null;
                        currentDriverRide = null;
                        showDriverTab('driver-requests');
                        showToast('Course terminée !');
                        if (currentRole === 'driver' && currentUser) loadDriverHistory();
                        if (driverTrackingMap) {
                            driverTrackingMap.remove();
                            driverTrackingMap = null;
                        }
                    } catch (error) {
                        showToast('Erreur : ' + error.message);
                    } finally {
                        hideLoading();
                    }
                } else {
                    showToast('Aucune course active.');
                }
            });
        }

        if (driverCancelBtn) {
            driverCancelBtn.addEventListener('click', async () => {
                if (activeRideId) {
                    if (confirm('Annuler cette course ?')) {
                        showLoading();
                        try {
                            await db.collection('rides').doc(activeRideId).update({ status: 'cancelled' });
                            
                            // Envoyer la mise à jour à Google Sheets
                            sendToGoogleSheets({
                                id: activeRideId,
                                status: 'cancelled',
                                updatedAt: new Date().toISOString()
                            });
                            
                            activeRideId = null;
                            currentDriverRide = null;
                            showDriverTab('driver-requests');
                            showToast('Course annulée.');
                            if (currentRole === 'driver' && currentUser) loadDriverHistory();
                        } catch (error) {
                            showToast('Erreur : ' + error.message);
                        } finally {
                            hideLoading();
                        }
                    }
                } else {
                    showToast('Aucune course active.');
                }
            });
        }

        // Client : messagerie et actions
        if (chatSendBtn) {
            chatSendBtn.addEventListener('click', () => {
                if (activeRideId) {
                    sendMessage(activeRideId, chatInput.value, 'client');
                } else {
                    showToast('Aucune course active pour envoyer un message.');
                }
                chatInput.value = '';
            });
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') chatSendBtn.click();
            });
        }
        if (completeBtn) {
            completeBtn.addEventListener('click', async () => {
                if (activeRideId) {
                    showLoading();
                    try {
                        await db.collection('rides').doc(activeRideId).update({ status: 'completed' });
                        
                        // Envoyer la mise à jour à Google Sheets
                        sendToGoogleSheets({
                            id: activeRideId,
                            status: 'completed',
                            updatedAt: new Date().toISOString()
                        });
                        
                        activeRideId = null;
                        resetClientBooking();
                        if (bookingDiv) bookingDiv.style.display = 'block';
                        if (waitingDiv) waitingDiv.style.display = 'none';
                        showClientTab('rides');
                        showToast('Course terminée !');
                    } catch (error) {
                        showToast('Erreur : ' + error.message);
                    } finally {
                        hideLoading();
                    }
                } else {
                    showToast('Aucune course active.');
                }
            });
        }
        if (cancelRideBtn) {
            cancelRideBtn.addEventListener('click', async () => {
                if (activeRideId) {
                    if (confirm('Annuler cette course ?')) {
                        showLoading();
                        try {
                            await db.collection('rides').doc(activeRideId).update({ status: 'cancelled' });
                            
                            // Envoyer la mise à jour à Google Sheets
                            sendToGoogleSheets({
                                id: activeRideId,
                                status: 'cancelled',
                                updatedAt: new Date().toISOString()
                            });
                            
                            activeRideId = null;
                            resetClientBooking();
                            if (bookingDiv) bookingDiv.style.display = 'block';
                            if (waitingDiv) waitingDiv.style.display = 'none';
                            showClientTab('rides');
                            showToast('Course annulée.');
                        } catch (error) {
                            showToast('Erreur : ' + error.message);
                        } finally {
                            hideLoading();
                        }
                    }
                } else {
                    showToast('Aucune course active.');
                }
            });
        }

        // now / later
        if (nowBtn && laterBtn) {
            nowBtn.addEventListener('click', () => {
                nowBtn.classList.add('active');
                laterBtn.classList.remove('active');
                datetimePicker.style.display = 'none';
            });
            laterBtn.addEventListener('click', () => {
                laterBtn.classList.add('active');
                nowBtn.classList.remove('active');
                datetimePicker.style.display = 'block';
            });
        }

        // Modal
        if (closeModal && modalCloseBtn && modal) {
            closeModal.onclick = () => modal.style.display = 'none';
            modalCloseBtn.onclick = () => modal.style.display = 'none';
        }

        // Onglets client
        if (clientTabs) {
            document.querySelectorAll('#client-tabs .tab-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (currentRole !== 'client') return;
                    const tabId = btn.dataset.tab;
                    if (activeRideId !== null && tabId !== 'tracking') {
                        showToast('Vous ne pouvez pas quitter la messagerie tant que la course est en cours.');
                        return;
                    }
                    showClientTab(tabId);
                    if (tabId === 'activity') {
                        if (currentUser) loadClientHistory();
                        else document.getElementById('rides-history').innerHTML = '<p>Veuillez vous connecter pour voir votre activité.</p>';
                    }
                    if (tabId === 'account') {
                        if (currentUser) showProfile();
                    }
                });
            });
        }

        // Onglets conductrice
        if (driverTabs) {
            document.querySelectorAll('#driver-tabs .tab-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (currentRole !== 'driver') return;
                    const tabId = btn.dataset.tab;
                    showDriverTab(tabId);
                    if (tabId === 'driver-history') {
                        if (currentUser) loadDriverHistory();
                        else document.getElementById('driver-history-list').innerHTML = '<p>Veuillez vous connecter pour voir votre historique.</p>';
                    }
                    if (tabId === 'driver-account') {
                        if (currentUser) showDriverProfile();
                    }
                    if (tabId === 'driver-active') {
                        if (activeRideId && currentUser) {
                            if (currentDriverRide) {
                                loadMessages(activeRideId, 'driver');
                            } else {
                                db.collection('rides').doc(activeRideId).get().then(doc => {
                                    if (doc.exists) {
                                        currentDriverRide = doc.data();
                                        loadMessages(activeRideId, 'driver');
                                    }
                                });
                            }
                        }
                    }
                });
            });
        }

        // Carte client
        setTimeout(() => {
            if (!map && document.getElementById('map')) {
                initMap();
            }
        }, 500);
    });
})();

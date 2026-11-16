/**
 * CSI Niger v2.0 — Script Frontend Léger
 * Navigation gérée par HTMX, état local par Alpine.js
 */

document.addEventListener('alpine:init', () => {
  // Alpine.js est prêt
});

// Gestion simple des modales/dialogs de manière native
document.body.addEventListener('htmx:afterOnLoad', () => {
    // Réinitialisation des états si nécessaire après chargement HTMX
});

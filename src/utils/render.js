
/**
 * Utilitaires pour rendre des fragments HTML avec HTMX
 */
module.exports = {
  // Enveloppe un contenu dans un conteneur standard pour HTMX
  fragment: (content, title = '') => {
    return `
      <div class="fragment-container" hx-boost="true">
        ${title ? `<h2>${title}</h2>` : ''}
        ${content}
      </div>
    `;
  }
};

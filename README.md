# HexaVO — Plateforme de gestion automobile France (Particulier, Micro-entrepreneur & Pro)

HexaVO centralise l'ensemble du cycle de vie automobile en France au sein **d'un compte unifié** : gestion de parc multi-contexte (`Particulier` et `Professionnel`), achats, ventes anti-doublon, CRM clients/fournisseurs, dépenses véhicule vs frais généraux, documents & préparation Cerfa 15776*02, Livre de Police chronologique immuable, facturation Factur-X (XML CII + PDF hybride), trésorerie, simulateur fiscal paramétrable, Marketplace publique intégrée et calendrier.

## Démarrage rapide

```bash
npm install
npm run dev
```

L'application démarre sur `http://localhost:3000`.

### Compte de démonstration
- Bouton **"Accès Démo (1 clic)"** directement sur l'écran de connexion (`demo@hexavo.fr` / `HexaVO2026!`)
- Inclut 1 profil professionnel (`Moreau Auto Sélection`), 4 véhicules (3 pro + 1 personnel), achats, vente, dépenses, factures Factur-X, écritures Livre de Police et annonces Marketplace publiques.

## Scripts & Tests

- `npm run dev` — Démarre le serveur Express + Vite sur le port `3000`
- `npm run build` — Compile le frontend Vite + bundle le serveur Node.js (`server.js`)
- `npm run lint` — Vérification TypeScript (`tsc --noEmit`)
- `npx tsx --test server/services/*.test.ts` — Exécute la suite de tests unitaires & d'intégration backend (TVA, fiscalité, trésorerie, Factur-X XML, automatisation vente & Livre de Police)

## Documentation technique

Consultez [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) pour le schéma complet des 30 tables SQLite, l'architecture des services, la sécurité (sessions `HttpOnly`, CSRF, `scrypt`) et les mentions légales françaises (Cerfa 15776*02, Livre de Police, Factur-X / PA, fiscalité).

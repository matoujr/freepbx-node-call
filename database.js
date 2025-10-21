// database.js
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./chatbot.db', (err) => {
    if (err) {
        console.error('Erreur lors de la connexion à la base de données SQLite:', err.message);
    } else {
        console.log('Connecté à la base de données SQLite.');
        // Création des tables si elles n'existent pas
        db.run(`CREATE TABLE IF NOT EXISTS rappels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            numero TEXT NOT NULL,
            timestamp TEXT NOT NULL
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS rendezvous (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nom TEXT NOT NULL,
            date TEXT NOT NULL,
            heure TEXT NOT NULL,
            numero_mobile TEXT NOT NULL,
            objet_demande TEXT,
            timestamp TEXT NOT NULL
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            type TEXT DEFAULT 'general' -- 'general' ou 'private'
        )`);
        // Nouvelle table pour les utilisateurs
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`);
         // Nouvelle table pour les messages privés (correction de la faute de frappe IF_NOT_EXISTS -> IF NOT EXISTS)
        db.run(`CREATE TABLE IF NOT EXISTS private_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender TEXT NOT NULL,
            receiver TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TEXT NOT NULL
        )`);
    }
});

module.exports = db;
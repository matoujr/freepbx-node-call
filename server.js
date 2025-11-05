const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt'); // Pour le hachage des mots de passe
const AmiClient = require('asterisk-ami-client'); // Pour l'intégration FreePBX

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// --- Configuration AMI (Asterisk Manager Interface) ---
// valeurs par les informations de connexion de votre serveur Asterisk/FreePBX
const AMI_HOST = '192.168.100.43'; // IP de votre FreePBX
const AMI_PORT = 5038;
const AMI_USERNAME = 'nodejs';
const AMI_PASSWORD = '1234';

const ami = new AmiClient({
    reconnect: true,
    keepConnected: true
});

// Connexion AMI
ami.connect(AMI_USERNAME, AMI_PASSWORD, { host: AMI_HOST, port: AMI_PORT })
    .then(() => {
        console.log('✅ Connexion AMI établie.');
    })
    .catch(err => {
        console.error('Erreur de connexion AMI:', err);
    });

// Écoute des événements AMI 
ami.on('managerevent', (evt) => {
    if (evt.event === 'Newchannel' && evt.calleridnum) {
        console.log(`📞 Appel entrant détecté: De ${evt.calleridnum} (${evt.calleridname || 'Inconnu'})`);
        io.emit('ficheClient', {
            numero: evt.calleridnum,
            nom: evt.calleridname || '',
            prenom: '',
            adresse: ''
        });
    }
});

// --- Middleware pour parser le JSON et servir les fichiers statiques ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Chemins des fichiers de données ---
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const MESSAGES_FILE = path.join(__dirname, 'data', 'messages.json');
const PRIVATE_MESSAGES_FILE = path.join(__dirname, 'data', 'privateMessages.json');
const RAPPELS_FILE = path.join(__dirname, 'data', 'rappels.json');
const RENDEZVOUS_FILE = path.join(__dirname, 'data', 'rendezvous.json');

// --- Fonctions utilitaires pour lire/écrire les fichiers ---
const readJsonFile = (filePath, defaultContent = []) => {
    try {
        if (!fs.existsSync(filePath)) {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, JSON.stringify(defaultContent, null, 2));
            return defaultContent;
        }
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Erreur de lecture du fichier ${filePath}:`, error);
        return defaultContent;
    }
};

const writeJsonFile = (filePath, data) => {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error(`Erreur d'écriture du fichier ${filePath}:`, error);
    }
};

// Initialisation des fichiers de données si non existants
readJsonFile(USERS_FILE);
readJsonFile(MESSAGES_FILE);
readJsonFile(PRIVATE_MESSAGES_FILE);
readJsonFile(RAPPELS_FILE);
readJsonFile(RENDEZVOUS_FILE);

// --- Routes d'authentification ---
app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    const users = readJsonFile(USERS_FILE);

    if (users.some(u => u.username === username)) {
        return res.status(400).json({ success: false, message: 'Nom d\'utilisateur déjà pris.' });
    }
    if (users.some(u => u.email === email)) {
        return res.status(400).json({ success: false, message: 'Email déjà utilisé.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = { username, email, password: hashedPassword };
        users.push(newUser);
        writeJsonFile(USERS_FILE, users);
        io.emit('userRegistered', { username: newUser.username }); // Notifier les clients qu'un nouvel
        res.json({ success: true, message: 'Inscription réussie.' });
    } catch (error) {
        console.error('Erreur lors du hachage du mot de passe:', error);
        res.status(500).json({ success: false, message: 'Erreur interne du serveur.' });
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const users = readJsonFile(USERS_FILE);
    const user = users.find(u => u.username === username);

    if (!user) {
        return res.status(400).json({ success: false, message: 'Nom d\'utilisateur ou mot de passe incorrect.' });
    }

    try {
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (passwordMatch) {
            res.json({ success: true, message: 'Connexion réussie.' });
        } else {
            res.status(400).json({ success: false, message: 'Nom d\'utilisateur ou mot de passe incorrect.' });
        }
    } catch (error) {
        console.error('Erreur lors de la comparaison du mot de passe:', error);
        res.status(500).json({ success: false, message: 'Erreur interne du serveur.' });
    }
});

// --- Route pour la liste de tous les utilisateurs 
app.get('/api/users', (req, res) => {
    const users = readJsonFile(USERS_FILE);
    // Retourne seulement les noms d'utilisateur pour des raisons de sécurité et de simplicité
    res.json(users.map(user => ({ username: user.username })));
});


// --- Fonctionnalité d'appel FreePBX ---
function launchCall(from, to) {
    const originate = {
        Action: 'Originate',
        Channel: `PJSIP/${from}`,
        Context: 'from-internal',
        Exten: to,
        Priority: 1,
        CallerID: `poste ${from}`,
        Timeout: 30000
    };

     ami.action(originate, (err, res) => {
        if (err) {
            console.error('❌ Erreur AMI lors du lancement de l\'appel :', err);
        } else {
            console.log(`📞 Appel lancé avec succès : de ${from} vers ${to}`, res);
        }
    });
}

app.get('/call', (req, res) => {
    const { from, to } = req.query;

    if (!from || !to) {
        return res.status(400).send('❌ Paramètres "from" et "to" requis.');
    }

    launchCall(from, to);
    res.send('✅ Appel lancé avec succès !');
});


// --- Routes pour le Chatbot (avec logique simple) ---
app.post('/chatbot', (req, res) => {
    const message = req.body.message.toLowerCase();
    let reply = "Je ne comprends pas. Pouvez-vous reformuler ?";
    let action = 'none'; // Action pour le front-end (ex: demander plus d'infos)

    if (message.includes('bonjour') || message.includes('salut')) {
        reply = "Bonjour ! Comment puis-je vous aider aujourd'hui ?";
    } else if (message.includes('rappel')) {
        reply = "Très bien. Veuillez nous laisser votre numéro (10 chiffres) et un conseiller vous rappellera sous peu.";
        action = 'callbackRequest';
    } else if (message.includes('offre') || message.includes('souscrire')) {
        reply = "Nous avons plusieurs offres disponibles. Souhaitez-vous une assistance personnalisée ?";
        action = 'offerConfirmation'; // On signale qu'il faut afficher Oui / Non
    }else if (action === 'offerConfirmation_yes') {
        // Lancer l'appel si l'utilisateur clique sur Oui
        launchCall('1001', '1002');
        reply = "Un conseiller vous appelle maintenant...";
        action = 'done';
    }
    else if (action === 'offerConfirmation_no') {
        reply = "Merci pour votre visite. À bientôt !";
        action = 'done';
    }else if (message.includes('rendez-vous') || message.includes('technicien')) {
        reply = "D’accord. Pour planifier l’intervention, veuillez me donner les informations suivantes séparées par des virgules et dans cet ordre : Votre Nom, la Date (JJ/MM/AAAA), l'Heure (HH:MM), votre Numéro mobile (10 chiffres) et enfin l'Objet de votre demande (Ex: 'Jean Dupont, 29/07/2025, 10:30, 0612345678, Installation Fibre').";
        action = 'technicianAppointment';
    } else if (message.includes('aide') || message.includes('question')) {
        reply = "Je suis là pour vous aider. N'hésitez pas à me poser vos questions sur nos services ou à demander un rappel.";
    } else {
        // Fallback ou traitement avancé 
        reply = "Désolé, je n'ai pas compris votre demande. Pourriez-vous choisir une option ou reformuler votre question ?";
    }

    res.json({ reply, action });
});

// --- Routes API pour la gestion des rappels clients ---
app.post('/api/rappel-client', (req, res) => {
    const { numero } = req.body;
    if (!numero) {
        return res.status(400).json({ success: false, message: 'Numéro de téléphone requis.' });
    }

    const rappels = readJsonFile(RAPPELS_FILE);
    const newRappel = { numero, timestamp: new Date().toISOString() };
    rappels.push(newRappel);
    writeJsonFile(RAPPELS_FILE, rappels);

    io.emit('rappelsClientUpdate', rappels); // Notifier tous les clients de la mise à jour
    res.json({ success: true, message: 'Demande de rappel enregistrée.' });
});

app.get('/api/rappels', (req, res) => {
    const rappels = readJsonFile(RAPPELS_FILE);
    res.json(rappels);
});

// --- Routes API pour la gestion des rendez-vous techniciens ---
app.post('/api/rendezvous-technicien', (req, res) => {
    const { nom, date, heure, numero_mobile, objet_demande } = req.body;
    if (!nom || !date || !heure || !numero_mobile) {
        return res.status(400).json({ success: false, message: 'Nom, date, heure et numéro mobile sont requis.' });
    }

    const rendezvousList = readJsonFile(RENDEZVOUS_FILE);
    const newRendezVous = { nom, date, heure, numero_mobile, objet_demande, timestamp: new Date().toISOString() };
    rendezvousList.push(newRendezVous);
    writeJsonFile(RENDEZVOUS_FILE, rendezvousList);

    io.emit('rendezVousTechnicienUpdate', rendezvousList); // Notifier tous les clients de la mise à jour
    res.json({ success: true, message: 'Rendez-vous enregistré.' });
});

app.get('/api/rendezvous', (req, res) => {
    const rendezvousList = readJsonFile(RENDEZVOUS_FILE);
    res.json(rendezvousList);
});

// Routes API pour la messagerie générale
app.post('/api/messages', (req, res) => {
    const { sender, content } = req.body;
    if (!sender || !content) {
        return res.status(400).json({ success: false, message: 'Expéditeur et contenu du message requis.' });
    }

    const messages = readJsonFile(MESSAGES_FILE);
    const newMessage = { sender, content, timestamp: new Date().toISOString() };
    messages.push(newMessage);
    writeJsonFile(MESSAGES_FILE, messages);

    io.emit('messageUpdate', messages); // Notifier tous les clients qu'un nouveau message est disponible
    res.json({ success: true, message: 'Message envoyé.' });
});

app.get('/api/messages', (req, res) => {
    const messages = readJsonFile(MESSAGES_FILE);
    res.json(messages);
});

//  Routes API pour la messagerie privée 
app.post('/api/private-messages', (req, res) => {
    const { sender, recipient, content } = req.body;
    if (!sender || !recipient || !content) {
        return res.status(400).json({ success: false, message: 'Expéditeur, destinataire et contenu du message privé requis.' });
    }

    const privateMessages = readJsonFile(PRIVATE_MESSAGES_FILE);
    const newPrivateMessage = { sender, recipient, content, timestamp: new Date().toISOString() };
    privateMessages.push(newPrivateMessage);
    writeJsonFile(PRIVATE_MESSAGES_FILE, privateMessages);

    // Émettre un événement spécifique pour le message privé
    io.emit('privateMessageUpdate', newPrivateMessage);
    res.json({ success: true, message: 'Message privé envoyé.' });
});

// Route pour récupérer les messages privés entre deux utilisateurs
// CORRIGÉ: Utilisation de req.params pour les noms d'utilisateur dans l'URL
app.get('/api/private-messages/:user1/:user2', (req, res) => {
    const { user1, user2 } = req.params;
    const privateMessages = readJsonFile(PRIVATE_MESSAGES_FILE);

    // Filtrer les messages où user1 est l'expéditeur et user2 le destinataire, OU vice-versa
    const conversation = privateMessages.filter(msg =>
        (msg.sender === user1 && msg.recipient === user2) ||
        (msg.sender === user2 && msg.recipient === user1)
    ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)); // Trier par timestamp

    res.json(conversation);
});


// --- Lancement du serveur ---
server.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
    console.log(`Accédez à l'application via http://localhost:${PORT}`);
});
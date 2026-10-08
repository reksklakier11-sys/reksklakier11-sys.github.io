const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Events
} = require("discord.js");

const express = require("express");
const https = require("https");
const selfsigned = require("selfsigned");
const crypto = require("crypto");
require("dotenv").config();

const app = express();

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// =========================
// FACEIT OAuth
// =========================

const pendingAuth = new Map();

function createPKCE() {
    const codeVerifier = crypto.randomBytes(32).toString("base64url");

    const codeChallenge = crypto
        .createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");

    return {
        codeVerifier,
        codeChallenge
    };
}

// =========================
// DISCORD BOT
// =========================

client.once(Events.ClientReady, async () => {
    console.log(`✅ Bot zalogowany jako ${client.user.tag}`);

    await client.application.commands.set([
        {
            name: "verify",
            description: "Połącz swoje konto Discord z FACEIT"
        }
    ]);

    console.log("✅ Komenda /verify została zarejestrowana");
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "verify") {
        const authUrl =
            `https://orly-faceit-bot.onrender.com/auth/faceit?discord_id=${interaction.user.id}`;

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel("🎮 Połącz FACEIT")
                .setStyle(ButtonStyle.Link)
                .setURL(authUrl)
        );

        await interaction.reply({
            content:
                "🔗 **Połącz swoje konto FACEIT**\n\n" +
                "Kliknij przycisk poniżej, aby rozpocząć weryfikację.",
            components: [row],
            ephemeral: true
        });
    }
});

// =========================
// START FACEIT LOGIN
// =========================

app.get("/auth/faceit", (req, res) => {
    const discordId = req.query.discord_id;

    if (!discordId) {
        return res.status(400).send("Brak Discord ID.");
    }

    const state = crypto.randomBytes(32).toString("hex");
    const { codeVerifier, codeChallenge } = createPKCE();

    pendingAuth.set(state, {
        discordId,
        codeVerifier
    });

    const params = new URLSearchParams({
        client_id: process.env.FACEIT_CLIENT_ID,
        redirect_uri: process.env.REDIRECT_URI,
        response_type: "code",
        scope: "openid",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256"
    });

    const url = `https://accounts.faceit.com?${params.toString()}`;

    res.redirect(url);
});

// =========================
// FACEIT CALLBACK
// =========================

app.get("/callback", async (req, res) => {
    try {
        const { code, state } = req.query;

        if (!code || !state) {
            return res.status(400).send("Brak code lub state.");
        }

        const auth = pendingAuth.get(state);

        if (!auth) {
            return res.status(400).send("Nieprawidłowy lub wygasły state.");
        }

        pendingAuth.delete(state);

        const basicAuth = Buffer
            .from(
                `${process.env.FACEIT_CLIENT_ID}:${process.env.FACEIT_CLIENT_SECRET}`
            )
            .toString("base64");

        const tokenResponse = await fetch(
            "https://api.faceit.com/auth/v1/oauth/token",
            {
                method: "POST",
                headers: {
                    "Authorization": `Basic ${basicAuth}`,
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body: new URLSearchParams({
                    grant_type: "authorization_code",
                    code: code,
                    redirect_uri: process.env.REDIRECT_URI,
                    code_verifier: auth.codeVerifier
                })
            }
        );

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok) {
            console.error("FACEIT TOKEN ERROR:", tokenData);
            return res.status(500).send("Nie udało się zalogować przez FACEIT.");
        }

        const userResponse = await fetch(
            "https://api.faceit.com/auth/v1/resources/userinfo",
            {
                headers: {
                    Authorization: `Bearer ${tokenData.access_token}`
                }
            }
        );

        const faceitUser = await userResponse.json();

        if (!userResponse.ok) {
            console.error("FACEIT USER ERROR:", faceitUser);
            return res.status(500).send("Nie udało się pobrać konta FACEIT.");
        }

        console.log("================================");
        console.log("✅ POŁĄCZONO KONTO");
        console.log("Discord ID:", auth.discordId);
        console.log("FACEIT:", faceitUser);
        console.log("================================");

        res.send(`
            <html>
                <head>
                    <title>ORLY FACEIT</title>
                </head>
                <body style="font-family: Arial; text-align:center; padding-top:80px;">
                    <h1>✅ Konto FACEIT połączone!</h1>
                    <p>Możesz wrócić na Discorda.</p>
                </body>
            </html>
        `);

    } catch (error) {
        console.error(error);
        res.status(500).send("Wystąpił błąd.");
    }
});

// =========================
// HTTPS SERVER
// =========================

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🌐 Serwer działa na porcie ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);

// WhatsApp integration service (placeholder)
// Requires whatsapp-web.js and a connected session
// This is disabled by default (whatsapp_enabled = false in configs)

class WhatsAppService {
  constructor() {
    this.client = null;
    this.ready = false;
  }

  async initialize() {
    console.log('[WhatsApp] Service is disabled. Set whatsapp_enabled=true in configs to activate.');
    // Full implementation would use whatsapp-web.js:
    // const { Client, LocalAuth } = require('whatsapp-web.js');
    // this.client = new Client({ authStrategy: new LocalAuth() });
    // this.client.on('qr', qr => { require('qrcode-terminal').generate(qr, { small: true }); });
    // this.client.on('ready', () => { this.ready = true; });
    // await this.client.initialize();
  }

  async sendMessage(number, message) {
    if (!this.ready) {
      console.log('[WhatsApp] Not connected. Message not sent:', message);
      return false;
    }
    return false;
  }

  async parseGroupMessages() {
    // Would parse messages from the configured group for clock-in/out entries
    return [];
  }
}

module.exports = new WhatsAppService();

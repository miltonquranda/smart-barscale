"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sgMail = require('@sendgrid/mail');
class EmailCtrl {
    constructor() {
        this.mail = sgMail;
        this.sendMessage = (req, res) => {
            this.mail.setApiKey(process.env.SENDGRID_API_KEY);
            const msg = {
                to: 'shanepisko@gmail.com',
                from: 'test@example.com',
                templateId: 'd-1825434c64924f55b6e3fe13ba36f4ba',
                content: [
                    { type: 'text/html', value: 'test' }
                ],
                dynamic_template_data: {
                    subject: 'Password Reset',
                    name: 'shane',
                    resetLink: `http://${process.env.API_URL}/password-reset?=test-reset-token`,
                },
            };
            this.mail.send(msg);
            res.send('ok');
        };
        this.passwordReset = (to, token) => {
            // generate a password reset token
            this.mail.setApiKey(process.env.SENDGRID_API_KEY);
            const msg = {
                to,
                from: 'test@example.com',
                templateId: 'd-1825434c64924f55b6e3fe13ba36f4ba',
                content: [
                    { type: 'text/html', value: 'test' }
                ],
                dynamic_template_data: {
                    subject: 'Password Reset',
                    name: to,
                    resetLink: `http://${process.env.API_URL}/password-reset?token=${token}`,
                },
            };
            return this.mail.send(msg);
        };
    }
}
exports.default = EmailCtrl;
//# sourceMappingURL=email.js.map
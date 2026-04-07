const config = require('../config');

exports.verifyBankAccount = async (req, res, next) => {
    try {
        const { account, bank_code } = req.query;

        if (!account || !bank_code) {
            return res.status(400).json({ ok: false, error: 'account and bank_code are required.' });
        }

        if (!/^\d{10,}$/.test(account)) {
            return res.status(400).json({ ok: false, error: 'Invalid account number format.' });
        }

        if (!config.paystack.secretKey) {
            return res.status(503).json({ ok: false, error: 'Bank verification not configured.' });
        }

        const response = await fetch(
            `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(account)}&bank_code=${encodeURIComponent(bank_code)}`,
            {
                headers: {
                    Authorization: `Bearer ${config.paystack.secretKey}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        const data = await response.json();

        if (data.status && data.data?.account_name) {
            return res.json({
                ok: true,
                data: {
                    account_name: data.data.account_name,
                    account_number: data.data.account_number,
                },
            });
        }

        return res.status(422).json({
            ok: false,
            error: data.message || 'Could not resolve account.',
        });

    } catch (err) {
        next(err);
    }
};
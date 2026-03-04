const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/documents');
const { upload } = require('../services/storage');

router.post('/upload',  authenticate, upload.array('files', 10), ctrl.upload);
router.get('/',         authenticate, ctrl.list);
router.get('/:id/url',  authenticate, ctrl.getSignedUrl);
router.delete('/:id',   authenticate, ctrl.remove);

module.exports = router;

//  path: src/pipe/pipeRoutes.js

const express = require('express');
const router = express.Router();
module.exports = (controller) => {
    router.post('/pipe/create', (req, res) => controller.createPipeTransport(req, res));
    router.post('/pipe/connect', (req, res) => controller.connectPipeTransport(req, res));
    router.post('/pipe/pipe-producer', (req, res) => controller.pipeProducer(req, res));

    return router;
};
// -- pipe/pipeController.js

module.exports = (serverState) => ({
    async create(req, res) {
        const { roomId } = req.body;

        const router = await serverState.getRouter(roomId); // your own logic
        const transport = await router.createPipeTransport({ listenIp: "0.0.0.0" });

        // Store transport somewhere with its id
        serverState.savePipeTransport(roomId, transport);

        res.json({
            id: transport.id,
            ip: transport.tuple.localIp,
            port: transport.tuple.localPort
        });
    },

    async connect(req, res) {
        const { transportId, ip, port } = req.body;

        const transport = serverState.getPipeTransportById(transportId);
        if (!transport) return res.status(404).send("Transport not found");

        await transport.connect({ ip, port });

        res.sendStatus(200);
    },

    async pipeProducer(req, res) {
        const { roomId, producerId } = req.body;

        const router = await serverState.getRouter(roomId);
        const transport = serverState.getPipeTransport(roomId);

        const remoteProducer = await serverState.getRemoteProducer(producerId);

        await transport.consume({
            producerId: remoteProducer.id,
            appData: { piped: true }
        });

        res.sendStatus(200);
    }
});

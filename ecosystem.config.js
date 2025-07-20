module.exports = {
  apps : [{
    name   : "app",
    script : "./src/server.js",
    instance_var: 'INSTANCE_ID',
    exec_mode: "fork",
    node_args: "--max-old-space-size=4096",
    env: {
        "NODE_ENV" : 'production',
        "SERVER_PORT": 3000,        
        "MEDIASOUP_LOG_LEVEL" :"error",
        "DEBUG":"mediasoup:WARN:* mediasoup:ERROR:*",
        "ENV STREAM_CLIENT_URL":"",
        "ENV SENTRY_DSN":"",
        "MAX_USERS_PER_SUB_ROOM":"",
        "CPU_THRESHOLD_PER_SUB_ROOM":"",
        "API_GETWAY": "https://apigateway.dev.zituredev.ir",
    }
  }]
}

module.exports = {
  apps: [{
    name: 'controle-ponto',
    script: 'server.js',
    cwd: '/home/claude/controle-ponto',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      LD_LIBRARY_PATH: '/tmp/libs/usr/lib/x86_64-linux-gnu'
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: '/home/claude/controle-ponto/logs/error.log',
    out_file: '/home/claude/controle-ponto/logs/output.log',
    merge_logs: true
  }]
};

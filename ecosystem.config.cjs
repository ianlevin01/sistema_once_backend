module.exports = {
  apps: [
    {
      name: "api",
      script: "src/index.js",
      node_args: "--max-old-space-size=1024",
      max_memory_restart: "1500M",
      restart_delay: 2000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};

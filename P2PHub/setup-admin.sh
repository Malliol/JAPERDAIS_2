#!/bin/bash
pkill -f admin.js 2>/dev/null; sleep 1

# Берём admin.js из ветки репозитория
git -C /var/www/p2phub fetch origin claude/explore-project-repo-c86qmc
git -C /var/www/p2phub checkout FETCH_HEAD -- admin.js
echo "admin.js size: $(wc -c < /var/www/p2phub/admin.js) bytes"

node /var/www/p2phub/admin.js &
sleep 1
echo "admin.js PID: $(pgrep -f admin.js)"

cat > /etc/nginx/sites-available/p2phub << 'NGINX'
server {
    listen 80;
    server_name _;
    root /var/www/p2phub;
    index index.html;

    location /admin {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX

nginx -t && systemctl reload nginx && echo "=== ГОТОВО ==="

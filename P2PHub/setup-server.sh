#!/bin/bash
# Установка сервера ОСГОворим на Ubuntu
set -e

echo "=== Установка ОСГОворим ==="

# Node.js 20 LTS
if ! command -v node &>/dev/null || [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt 18 ]]; then
  echo ">>> Устанавливаю Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# nginx, git
echo ">>> Устанавливаю nginx, git..."
apt-get install -y nginx git

# Папка проекта
mkdir -p /var/www/p2phub
chown -R www-data:www-data /var/www/p2phub

# Клонируем репо
echo ">>> Клонирую репозиторий..."
if [ -d /var/www/p2phub/.git ]; then
  git -C /var/www/p2phub pull
else
  git clone https://github.com/Malliol/p2phub.git /var/www/p2phub
fi

# nginx конфиг
echo ">>> Настраиваю nginx..."
cat > /etc/nginx/sites-available/p2phub << 'NGINX'
server {
    listen 80;
    server_name _;

    root /var/www/p2phub;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Backend API (когда появится)
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }

    # WebSocket для чата
    location /ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/p2phub /etc/nginx/sites-enabled/p2phub
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo ""
echo "=== ГОТОВО ==="
echo "Node.js: $(node -v)"
echo "nginx:   $(nginx -v 2>&1)"
echo "Сайт:    http://144.31.63.224"
echo "Папка:   /var/www/p2phub"

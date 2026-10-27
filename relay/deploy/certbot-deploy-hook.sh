#!/bin/sh
# Restart clever's pairing server after certbot renews the certificate, so it loads the new one.
# Install (as root):
#   cp deploy/certbot-deploy-hook.sh /etc/letsencrypt/renewal-hooks/deploy/clever-relay.sh
#   chmod +x /etc/letsencrypt/renewal-hooks/deploy/clever-relay.sh
# clever and the phones reconnect by themselves after the restart.
systemctl try-restart clever-relay.service

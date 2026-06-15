// _worker.js

// Docker镜像仓库主机地址
let hub_host = 'registry-1.docker.io';
// Docker认证服务器地址
const auth_url = 'https://auth.docker.io';

let 屏蔽爬虫UA = ['netcraft'];

// 根据主机名选择对应的上游地址
function routeByHosts(host) {
	const routes = {
		"quay": "quay.io",
		"gcr": "gcr.io",
		"k8s-gcr": "k8s.gcr.io",
		"k8s": "registry.k8s.io",
		"ghcr": "ghcr.io",
		"cloudsmith": "docker.cloudsmith.io",
		"nvcr": "nvcr.io",
		"test": "registry-1.docker.io",
	};
	if (host in routes) return [routes[host], false];
	else return [hub_host, true];
}

/** @type {RequestInit} */
const PREFLIGHT_INIT = {
	headers: new Headers({
		'access-control-allow-origin': '*',
		'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
		'access-control-max-age': '1728000',
	}),
}

function makeRes(body, status = 200, headers = {}) {
	headers['access-control-allow-origin'] = '*'
	return new Response(body, { status, headers })
}

function newUrl(urlStr, base) {
	try {
		return new URL(urlStr, base);
	} catch (err) {
		return null
	}
}

async function nginx() {
	return `<!DOCTYPE html><html><head><title>Welcome to nginx!</title><style>body { width: 35em; margin: 0 auto; font-family: Tahoma, Arial, sans-serif; }</style></head><body><h1>Welcome to nginx!</h1><p>If you see this page, the nginx web server is successfully installed.</p></body></html>`;
}

async function searchInterface() {
	return `
	<!DOCTYPE html>
	<html>
	<head>
		<title>Docker Hub 镜像搜索</title>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<style>
			body { font-family: system-ui, sans-serif; display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: linear-gradient(135deg, #1a90ff 0%, #003eb3 100%); color: white; text-align: center; }
			.container { padding: 20px; width: 100%; max-width: 600px; }
			.search-container { display: flex; margin: 20px 0; height: 50px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); border-radius: 8px; overflow: hidden; }
			#search-input { flex: 1; padding: 0 15px; font-size: 16px; border: none; outline: none; }
			#search-button { width: 80px; background: #0066ff; color: white; border: none; font-size: 16px; cursor: pointer; font-weight: bold; }
			#search-button:hover { background: #0052cc; }
			p { color: rgba(255,255,255,0.8); font-size: 14px; }
		</style>
	</head>
	<body>
		<div class="container">
			<h1>Docker Hub 镜像搜索</h1>
			<p>快速查找、下载和部署 Docker 容器镜像</p>
			<div class="search-container">
				<input type="text" id="search-input" placeholder="输入关键词搜索镜像，如: nginx, mysql...">
				<button id="search-button">搜索</button>
			</div>
			<p>基于 Cloudflare 全球边缘网络实现毫秒级响应。</p>
		</div>
		<script>
		function performSearch() {
			const query = document.getElementById('search-input').value;
			if (query) window.location.href = '/search?q=' + encodeURIComponent(query);
		}
		document.getElementById('search-button').addEventListener('click', performSearch);
		document.getElementById('search-input').addEventListener('keypress', function(e) {
			if (e.key === 'Enter') performSearch();
		});
		window.addEventListener('load', function() { document.getElementById('search-input').focus(); });
		</script>
	</body>
	</html>
	`;
}

export default {
	async fetch(request, env, ctx) {
		const getReqHeader = (key) => request.headers.get(key);

		let url = new URL(request.url);
		const userAgentHeader = request.headers.get('User-Agent');
		const userAgent = userAgentHeader ? userAgentHeader.toLowerCase() : "null";
		if (env.UA) 屏蔽爬虫UA = 屏蔽爬虫UA.concat(await ADD(env.UA));
		const workers_url = `https://${url.hostname}`;

		const ns = url.searchParams.get('ns');
		const hostname = url.searchParams.get('hubhost') || url.hostname;
		const hostTop = hostname.split('.')[0];

		let checkHost;
		if (ns) {
			if (ns === 'docker.io') {
				hub_host = 'registry-1.docker.io';
			} else {
				hub_host = ns;
			}
		} else {
			checkHost = routeByHosts(hostTop);
			hub_host = checkHost[0];
		}

		const fakePage = checkHost ? checkHost[1] : false;
		url.hostname = hub_host;
		const hubParams = ['/v1/search', '/v1/repositories'];

		if (屏蔽爬虫UA.some(fxxk => userAgent.includes(fxxk)) && 屏蔽爬虫UA.length > 0) {
			return new Response(await nginx(), { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
		} else if ((userAgent && userAgent.includes('mozilla')) || hubParams.some(param => url.pathname.includes(param))) {
			if (url.pathname == '/') {
				if (env.URL302) {
					return Response.redirect(env.URL302, 302);
				} else if (env.URL) {
					if (env.URL.toLowerCase() == 'nginx') {
						return new Response(await nginx(), { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
					} else return fetch(new Request(env.URL, request));
				} else {
					if (fakePage) return new Response(await searchInterface(), { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
				}
			} else {
				if (url.pathname.startsWith('/v1/')) {
					url.hostname = 'registry-1.docker.io';
				} else if (fakePage) {
					url.hostname = 'hub.docker.com';
				}
				if (url.searchParams.get('q')?.includes('library/') && url.searchParams.get('q') != 'library/') {
					const search = url.searchParams.get('q');
					url.searchParams.set('q', search.replace('library/', ''));
				}
				
				if (env.DOCKER_USERNAME && env.DOCKER_PASSWORD) {
					const rawAuth = `${env.DOCKER_USERNAME}:${env.DOCKER_PASSWORD}`;
					const authValue = typeof btoa !== 'undefined' ? btoa(rawAuth) : Buffer.from(rawAuth).toString('base64');
					request.headers.set("Authorization", `Basic ${authValue}`);
				}

				return fetch(new Request(url, request));
			}
		}

		if (!/%2F/.test(url.search) && /%3A/.test(url.toString())) {
			let modifiedUrl = url.toString().replace(/%3A(?=.*?&)/, '%3Alibrary%2F');
			url = new URL(modifiedUrl);
		}

		if (url.pathname.includes('/token')) {
			let token_parameter = {
				headers: {
					'Host': 'auth.docker.io',
					'User-Agent': getReqHeader("User-Agent"),
					'Accept': getReqHeader("Accept"),
					'Accept-Language': getReqHeader("Accept-Language"),
					'Accept-Encoding': getReqHeader("Accept-Encoding"),
					'Connection': 'keep-alive',
					'Cache-Control': 'max-age=0'
				}
			};
			return fetch(new Request(auth_url + url.pathname + url.search, request), token_parameter);
		}

		if (hub_host == 'registry-1.docker.io' && /^\/v2\/[^/]+\/[^/]+\/[^/]+$/.test(url.pathname) && !/^\/v2\/library/.test(url.pathname)) {
			url.pathname = '/v2/library/' + url.pathname.split('/v2/')[1];
		}

		if (url.pathname.startsWith('/v2/') && (url.pathname.includes('/manifests/') || url.pathname.includes('/blobs/') || url.pathname.includes('/tags/') || url.pathname.endsWith('/tags/list'))) {
			let repo = '';
			const v2Match = url.pathname.match(/^\/v2\/(.+?)(?:\/(manifests|blobs|tags)\/)/);
			if (v2Match) repo = v2Match[1];
			
			if (repo) {
				const tokenRes = await fetch(`${auth_url}/token?service=registry.docker.io&scope=repository:${repo}:pull`, {
					headers: {
						'User-Agent': getReqHeader("User-Agent"),
						'Accept': getReqHeader("Accept"),
						'Connection': 'keep-alive'
					}
				});
				const tokenData = await tokenRes.json();
				const token = tokenData.token;
				let parameter = {
					headers: {
						'Host': hub_host,
						'User-Agent': getReqHeader("User-Agent"),
						'Accept': getReqHeader("Accept"),
						'Connection': 'keep-alive',
						'Authorization': `Bearer ${token}`
					},
					cacheTtl: 3600
				};
				if (request.headers.has("X-Amz-Content-Sha256")) {
					parameter.headers['X-Amz-Content-Sha256'] = getReqHeader("X-Amz-Content-Sha256");
				}
				let original_response = await fetch(new Request(url, request), parameter);
				let original_text = original_response.clone().body;
				let new_response_headers = new Headers(original_response.headers);
				
				if (new_response_headers.get("Www-Authenticate")) {
					new_response_headers.set("Www-Authenticate", original_response.headers.get("Www-Authenticate").replace(new RegExp(auth_url, 'g'), workers_url));
				}
				if (new_response_headers.get("Location")) {
					return httpHandler(request, new_response_headers.get("Location"), hub_host);
				}
				return new Response(original_text, { status: original_response.status, headers: new_response_headers });
			}
		}

		if (env.DOCKER_USERNAME && env.DOCKER_PASSWORD) {
			const rawAuth = `${env.DOCKER_USERNAME}:${env.DOCKER_PASSWORD}`;
			const authValue = typeof btoa !== 'undefined' ? btoa(rawAuth) : Buffer.from(rawAuth).toString('base64');
			request.headers.set("Authorization", `Basic ${authValue}`);
		}

		let parameter = {
			headers: {
				'Host': hub_host,
				'User-Agent': getReqHeader("User-Agent"),
				'Accept': getReqHeader("Accept"),
				'Connection': 'keep-alive'
			},
			cacheTtl: 3600
		};

		if (request.headers.has("Authorization")) parameter.headers.Authorization = getReqHeader("Authorization");
		if (request.headers.has("X-Amz-Content-Sha256")) parameter.headers['X-Amz-Content-Sha256'] = getReqHeader("X-Amz-Content-Sha256");

		let original_response = await fetch(new Request(url, request), parameter);
		let original_text = original_response.clone().body;
		let new_response_headers = new Headers(original_response.headers);

		if (new_response_headers.get("Www-Authenticate")) {
			new_response_headers.set("Www-Authenticate", original_response.headers.get("Www-Authenticate").replace(new RegExp(auth_url, 'g'), workers_url));
		}

		if (new_response_headers.get("Location")) {
			return httpHandler(request, new_response_headers.get("Location"), hub_host);
		}

		return new Response(original_text, { status: original_response.status, headers: new_response_headers });
	}
};

function httpHandler(req, pathname, baseHost) {
	if (req.method === 'OPTIONS' && req.headers.has('access-control-request-headers')) {
		return new Response(null, PREFLIGHT_INIT);
	}
	const reqHdrNew = new Headers(req.headers);
	reqHdrNew.delete("Authorization");
	return proxy(newUrl(pathname, 'https://' + baseHost), { method: req.method, headers: reqHdrNew, redirect: 'follow', body: req.body });
}

async function proxy(urlObj, reqInit) {
	const res = await fetch(urlObj.href, reqInit);
	const resHdrNew = new Headers(res.headers);
	resHdrNew.set('access-control-expose-headers', '*');
	resHdrNew.set('access-control-allow-origin', '*');
	resHdrNew.set('Cache-Control', 'max-age=1500');
	resHdrNew.delete('content-security-policy');
	resHdrNew.delete('content-security-policy-report-only');
	resHdrNew.delete('clear-site-data');
	return new Response(res.body, { status: res.status, headers: resHdrNew });
}

async function ADD(envadd) {
	var addtext = envadd.replace(/[	 |"'\r\n]+/g, ',').replace(/,+/g, ',');
	if (addtext.charAt(0) == ',') addtext = addtext.slice(1);
	if (addtext.charAt(addtext.length - 1) == ',') addtext = addtext.slice(0, addtext.length - 1);
	return addtext.split(',');
}

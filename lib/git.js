var os = require('os');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var child = require('child_process');
var spawn = child.spawn;
var util = require('util');
var events = require('events');

var basic = require('basic');
var mkdirp = require('mkdirp');
var backend = require('git-http-backend');

// show debug messages if process.env.DEBUG === taco
var debug = require('debug')('taco');

module.exports = Git;

function Git(opts) {
	if (!(this instanceof Git))
		return new Git(opts);
	events.EventEmitter.call(this);
	var self = this;

	this.opts = opts || {};

	// set up default options
	if (!opts.dir)
		opts.dir = process.cwd();
	this.repoDir = opts.repoDir || path.join(opts.dir, 'repos');
	this.workDir = opts.workDir || path.join(opts.dir, 'checkouts');
	this.portsDir = opts.portsDir || path.join(opts.dir, 'ports');
	this.username = opts.username || process.env['USER'];
	this.password = opts.password || process.env['PASS'];

	this.auth = basic(opts.auth);
	
};
//
// Inherit from `events.EventEmitter`.
//
util.inherits(Git, events.EventEmitter);

Git.prototype.handle = function(req, res) {
	var self = this;

	var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress || req.connection.socket.remoteAddress;

	debug('Git.handle ' + ip + ' - ' + req.method + ' - ' + req.url);

	this.auth(req, res, function(err, creds) {
		if (err) {
			debug('Git.handle auth invalid user/pass', ip);
			res.statusCode = 401;
			res.setHeader('WWW-Authenticate', 'Basic realm="Secure Area"');
			return res.end('<html><body>Need some creds son</body></html>');
			return;
		}
		req.creds = creds;
		debug('Git.handle auth success, accepting request');
		accept();
	});

	function accept() {
		// hook the req/res up to git-http-backend
		var bs = backend(req.url, onService);
		req.pipe(bs).pipe(res);
	}

	// in a typical git push this will get called once for
	// 'info' and then again for 'push'
	function onService(err, service) {
		if (err) {
			debug('Git.handle onService  err: ' + err);
			return res.end(JSON.stringify({
				err : err.message
			}));
		}

		if (self.listeners('auth').length > 0) {
			self.emit('auth', {
				creds : req.creds,
				name : self.name(req.url.split('/')[2]),
				org : req.url.split('/')[1],
				action : service.action,
				read : req.method == 'GET',
				write : req.method !== 'GET'
			}, function(err, auth) {
				if (err) {
					debug('Git.handle onService  err: ' + err);
					return res.end(JSON.stringify({
						err : err.message
					}));
				}

				if (!auth) {
					debug('Git.handle auth invalid user/pass', ip);
					res.writeHead(err, {
						'WWW-Authenticate' : 'Basic realm="Secure Area"'
					});
					res.end();
					return;
				}
				self.onService(req, res, service);

			});
		} else {
			self.onService(req, res, service);
		}

	}

};

Git.prototype.onService = function(req, res, service) {

	var self = this;
	if (service.action === 'push') {
		service.sideband = service.createBand();
	}

	res.setHeader('content-type', service.type);
	// TODO pluggable url parsing
	var repo = req.url.split('/')[2];
	var org = req.url.split('/')[1];
	var dir = path.join(self.repoDir, org, repo);
	
	// create-if-not-exists the directory + bare git repo to store the incoming repo
	self.init(dir, function(err, sto, ste) {
		if (err || ste) {
			var errObj = {
				err : err,
				stderr : ste,
				stdout : sto
			};
			var errStr = JSON.stringify(errObj);
			debug('Git.handle onService ' + service.action + ' init dir err: ' + errStr);
			return res.end(errStr);
		}

		var serviceStream = service.createStream();

		// shell out to the appropriate `git` command, TODO implement this in pure JS :)
		var ps = spawn(service.cmd, service.args.concat(dir));
		ps.stdout.pipe(serviceStream).pipe(ps.stdin);

		debug('Git.onService spawn ' + service.cmd + ' ' + service.action+ ' ' + dir);

		ps.on('exit', function() {
			debug('Git.onService spawn ' + service.cmd + ' ' + service.action + ' finished');
			if (service.action === 'push') {
				self.handlePush({
					repo : repo,
					org : org,
					service : service
				});
			} else {

				self.emit(service.action, service);
			}
		});
	});
};

Git.prototype.init = function(dir, cb) {
	var self = this;
	fs.exists(dir, function(exists) {
		if (exists)
			return cb();
		mkdirp(dir, function(err) {
			if (err)
				return cb(err);
			debug('Git.init creating new bare repo in ' + dir);
			child.exec('git init --bare', {
				cwd : dir
			}, cb);
		});
	});
};

Git.prototype.handlePush = function(push, cb) {
	var self = this;
	if (!cb)
		cb = function noop() {
			//
		};
	var sideband = push.service.sideband;
	var checkoutDir = self.checkoutDir(push.org, push.repo);
	var name = self.name(push.repo);

	self.update(push, function(err) {
		if (err) {
			sideband.write('checkout error ' + err.message + '\n');
			debug('Git.handlePush update err: ' + err);
			return cb(err);
		}
		self.emit(push.service.action, push);
	});
};

Git.prototype.checkoutDir = function(org, repo) {
	return path.join(this.workDir, org, this.name(repo));
};

Git.prototype.name = function(repo) {
	return repo.split('.git')[0];
};

Git.prototype.update = function(push, cb) {
	var self = this;
	fs.exists(this.checkoutDir(push.org, push.repo), function(exists) {
		debug(push.repo + ' exists? ' + exists);
		if (!exists)
			return self.checkout(push, cb);
		self.pull(push, cb);
	});
};

Git.prototype.checkout = function(push, cb) {
	var self = this;
	var dir = this.checkoutDir(push.org, push.repo);
	mkdirp(dir, init);

	function init(err) {
		if (err)
			return cb('mkdirp(' + dir + ') failed');
		debug('mkdirp() ' + dir + ' finished');
		child.exec('git init', {
			cwd : dir
		}, function(err, stdo, stde) {
			if (err)
				return cb(err);
			debug('init() ' + dir + ' finished');
			fetch();
		});
	}

	function fetch() {
		var cmd = ['git', 'fetch', 'file://' + path.resolve(self.repoDir, push.org, push.repo), push.service.fields.branch].join(' ');

		child.exec(cmd, {
			cwd : dir
		}, function(err) {
			if (err)
				return cb(err);
			debug('fetch() ' + dir + ' finished');
			checkout();
		});
	}

	function checkout() {
		var cmd = ['git', 'checkout', '-b', push.service.fields.branch, push.service.fields.head].join(' ');

		child.exec(cmd, {
			cwd : dir
		}, function(err, stdo, stde) {
			cb(err, stdo, stde);
		});
	}

};

Git.prototype.pull = function(push, cb) {
	var self = this;
	var dir = this.checkoutDir(push.org, push.repo);
	push.id = push.service.fields.last + '.' + Date.now();
	var cmd = ['git', 'pull', 'file://' + path.resolve(self.repoDir, push.org, push.repo), push.service.fields.branch].join(' ');
	debug('Git.pull ' + dir + ': ' + cmd);
	child.exec(cmd, {
		cwd : dir
	}, function(err) {
		debug('Git.pull ' + dir + ' done: ' + err);
		if (err)
			return cb(err);
		cb(null);
	});
};

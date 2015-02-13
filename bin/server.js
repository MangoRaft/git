var Git = require('../lib/git');
var http = require('http');

var demo = {
	username : 'demo',
	password : 'demo'
};

var bob = {
	username : 'bob',
	password : 'bob'
};

var users = [demo, bob];

var repos = {
	falafel : {
		name : 'falafel',
		org : 'bob',
		url : 'http://localhost:5000/bob/falafel.git',
		users : [{
			user : demo,
			permissions : {
				read : true,
				write : true
			}
		}, {
			user : bob,
			permissions : {
				read : true,
				write : true
			}
		}]
	}
};

var git = new Git({
	auth : function(username, password, callback) {

		for (var i = 0,
		    j = users.length; i < j; i++) {

			if (users[i].username == username && users[i].password == password) {
				return callback(null, users[i]);
			}

		};
		callback(401);
	}
});
git.on('push', function(push) {
	console.log('push');

	push.service.sideband.end();
});
git.on('info', function(push) {
	console.log('info');
});
git.on('pull', function(push) {
	console.log('pull');
});
git.on('tag', function(push) {
	console.log('tag');
});
/**
 *
 *
 *
 */

git.on('auth', function(info, cb) {
	console.log('auth', info);
	var repo = repos[info.name];

	for (var i = 0,
	    j = repo.users.length; i < j; i++) {
		if (repo.users[i].user.username == info.creds.username) {
			if (repo.users[i].permissions.write == info.write) {
				return cb(null, true);
			}
			if (repo.users[i].permissions.read == info.read) {
				return cb(null, true);
			}
		}

	};
	cb(null, false);

});
http.createServer(git.handle.bind(git)).listen(process.env.PORT || 5000);

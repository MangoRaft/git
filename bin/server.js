var Git = require('../lib/git');
var http = require('http');

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
		organization : 'bob',
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
Object.keys(repos).forEach(function(key) {
	git.create(repos[key].organization, repos[key].name, function() {

	});
});
/**
 *
 *
 *
 */

git.perm(function(repo) {
	var info = repos[repo.name];
	for (var i = 0,
	    j = info.users.length; i < j; i++) {
		if (info.users[i].user.username == repo.credentials.username) {
			if (info.users[i].permissions.write == repo.write) {
				return repo.accept();
			}
			if (info.users[i].permissions.read == repo.read) {
				return repo.accept();
			}
		}
	};
	repo.reject();
});

git.on('sideband', function(repo) {
	console.log('sideband', repo);
	repo.sideband.end('all good\n');

});
http.createServer(git.handle.bind(git)).listen(process.env.PORT || 9001);

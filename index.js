var Resource = require('deployd/lib/resource')
  , Script = require('deployd/lib/script')
  , UserCollection = require('deployd/lib/resources/user-collection')
  , util = require('util')
  , url = require('url')

  , LocalStrategy = require('passport-local').Strategy
  , TwitterStrategy = require('passport-twitter').Strategy
  , FacebookStrategy = require('passport-facebook').Strategy;

function AuthResource() {
    Resource.apply(this, arguments);
}
util.inherits(AuthResource, Resource);

AuthResource.label = "Passport-Auth";
AuthResource.defaultPath = '/auth';
module.exports = AuthResource;

AuthResource.prototype.clientGeneration = false;

AuthResource.prototype.initPassport = function() {
    if(this.initialized) return;

    var config = this.config;
    config.SALT_LEN = config.SALT_LEN || 256;

    var passport = this.passport = require('passport');
    var userStore = process.server.createStore('users');

    // Will be called when socialLogins are done
    // Check for existing user and update
    // or create new user and insert
    var socialAuthCallback = function(token, tokenSecret, profile, done) {
        console.log('Login callback - profile:', profile);
        userStore.first({socialAccountId: profile.id}, function(err, user) {
            if(err) { return done(err); }

            var saveUser = user || {};
            saveUser.socialAccountId = profile.id;
            saveUser.socialAccount = profile.provider;
            saveUser.profile = profile;
            saveUser.name = profile.displayName;

            var cb = function(err, newUser) {
                console.log('save returned: ', arguments);
                if(err) { return done(err); }
                done(null, newUser||saveUser);
            };

            if(user) {
                userStore.update({id: user.id}, saveUser, cb);
            } else {
                userStore.insert(saveUser, cb);
            }
        });
    };

    if(config.allowLocal) {
        passport.use(new LocalStrategy(
          function(username, password, done) {
            userStore.first({username: username}, function(err, user) {
                if(err) { return done(err); }

                if(user) {
                    var salt = user.password.substr(0, config.SALT_LEN)
                      , hash = user.password.substr(config.SALT_LEN);

                    if(hash === UserCollection.prototype.hash(password, salt)) {
                        return done(null, user);
                    }
                }

                return done(null, false, { message: 'Invalid password' });
            });
          }
        ));
    }

    if(config.allowTwitter && config.baseURL && config.twitterConsumerKey && config.twitterConsumerSecret) {
        var cbURL = url.resolve(config.baseURL, this.path + '/twitter/callback');

        // console.log('Initializing Twitter Login, cb: %s', cbURL);
        passport.use(new TwitterStrategy({
            consumerKey: config.twitterConsumerKey,
            consumerSecret: config.twitterConsumerSecret,
            callbackURL: cbURL
          },
          socialAuthCallback
        ));
    }

    if(config.allowFacebook && config.baseURL && config.facebookAppId && config.facebookAppSecret) {
        var cbURL = url.resolve(config.baseURL, this.path + '/facebook/callback');

        // console.log('Initializing Facebook Login, cb: %s', cbURL);
        passport.use(new FacebookStrategy({
            clientID: config.facebookAppId,
            clientSecret: config.facebookAppSecret,
            callbackURL: cbURL
          },
          socialAuthCallback
        ));
    }

    this.initialized = true;
}

AuthResource.prototype.handle = function (ctx, next) {
    // globally handle logout
    if(ctx.url === '/logout') {
        if (ctx.res.cookies) ctx.res.cookies.set('sid', null);
        ctx.session.remove(ctx.done);
        return;
    }

    var parts = ctx.url.split('/').filter(function(p) { 
        // filters out all empty parts
        return p; 
    });

    // determine requested module
    var requestedModule, options = { session: false };
    switch(parts[0]) {
        case 'login':
            if(this.config.allowLocal) {
                requestedModule = 'local';
            }
            break;
        case 'twitter':
            if(this.config.allowTwitter) {
                requestedModule = 'twitter';
            }
            break;
        case 'facebook':
            if(this.config.allowFacebook) {
                requestedModule = 'facebook';
                if(this.config.facebookScope) {
                    try {
                        options.scope = JSON.parse(this.config.facebookScope);
                    } catch(ex) {
                        console.log('Error parsing the facebookScope');
                    }
                }
            }
            break;
        default:
            break;
    }

    if(requestedModule) {
        this.initPassport();
        this.passport.authenticate(requestedModule, options, function(err, user, info) {
            if (err || !user) {
                console.log('passport reported error: ', err, user, info);
                ctx.res.statusCode = 401;
                return ctx.done('bad credentials');
            }

            ctx.session.set({path: this.path, uid: user.id}).save(ctx.done);
            return;
        })(ctx.req, ctx.res);
    } else {
        // nothing matched, sorry
        ctx.res.statusCode = 401;
        return ctx.done('bad credentials');
    }
};

AuthResource.basicDashboard = {
  settings: [{
    name        : 'SALT_LEN',
    type        : 'numeric',
    description : 'Length of the Password salt that is used by deployd. Do not change if you don\'t know what this is or your users may not login anymore! Defaults to 256.'
  },{
    name        : 'baseURL',
    type        : 'text',
    description : 'Specify the Base URL of your site (http://www.your-page.com/) that is used for callbacks. *Required when using any OAuth Login!*'
  },{
    name        : 'allowLocal',
    type        : 'checkbox',
    description : 'Allow users to login via Username + Password'
  },{
    name        : 'allowTwitter',
    type        : 'checkbox',
    description : 'Allow users to login via Twitter (requires Twitter Key and Secret!)'
  },{
    name        : 'allowFacebook',
    type        : 'checkbox',
    description : 'Allow users to login via Facebook (requires Facebook Id and Secret!)'
  },{
    name        : 'twitterConsumerKey',
    type        : 'text'/*,
    description : 'TWITTER_CONSUMER_KEY'*/
  }, {
    name        : 'twitterConsumerSecret',
    type        : 'text'/*,
    description : 'TWITTER_CONSUMER_SECRET'*/
  },{
    name        : 'facebookAppId',
    type        : 'text'/*,
    description : 'TWITTER_CONSUMER_KEY'*/
  }, {
    name        : 'facebookAppSecret',
    type        : 'text'/*,
    description : 'TWITTER_CONSUMER_SECRET'*/
  }, {
    name        : 'facebookScope',
    type        : 'text',
    description : 'If your application needs extended permissions, they can be requested here. Supply as JS-Array: "[\'read_stream\']"'
  }]
};
var _ = require('underscore');

var db = require('./db');
var format = require('./format');


function filterUser(user) {
  // Timestamp is for favorited users
  return _.pick(user, 'id', 'name', 'lastlogin', 'timestamp');
}

function filterImage(image) {
  return _.pick(image, 'id', 'width', 'height', 'exif');
}

function filterVideo(video) {
  return _.pick(video, 'id', 'exif');
}

function filterMessage(message) {
  _.each(message.favorited, function(element, index, list) { list[index] = filterUser(element); });
  _.each(message.images, function(element, index, list) { list[index] = filterImage(element); });
  _.each(message.videos, function(element, index, list) { list[index] = filterVideo(element); });
  return _.pick(message, 'id', 'servertime', 'title', 'author', 'timestamp', 'images', 'videos', 'favorited');
}

function filterSearchQuery(query) {
  return _.pick(query, 'from', 'until', 'limit', 'offset', 'key', 'order_by');
}

function filterSearchResult(result, query) {
  result = _.clone(result);
  result.messages = _.map(result.messages, function(message, idx) {
    return filterMessage(message);
  });
  if (query) {
    result.query = filterSearchQuery(query);
  }
  return result;
}



exports.setup = function(config, app) {
  function authenticate(req, res, next) {
    if (config.noAuthentication) {
      req.user = {
        id: 1,
        admin: 1,
        deleted: 0,
        provider: 'github',
        identifier: '123456',
        username: 'admin',
        displayname: 'Admin',
        lastlogin: 1383422748916
      };
    }
    if (!req.user) {
      res.send(401, 'Unauthorized to view the resource');
    } else {
      next();
    }
  }

  app.get('/api/', authenticate, function(req, res) {
    res.send({
      users: '/api/user',
      user: '/api/user/1',
      favorites: '/api/user/1/favorite/',
      messages: '/api/message/',
      message: '/api/message/1',
      searchFavorites: '/api/search/favorites?order_by=favorited_desc,id_desc&offset=0&limit=20',
      searchFavoritesByUser: '/api/search/favorites/1',
      searchMessages: '/api/search/messages?from=1325376000000&until=1356998400000',
      searchImages: '/api/search/images?key=aki&order_by=id_desc&offset=0&limit=20',
      searchVideos: '/api/search/messages'
    });
  });

  app.get('/api/user/', authenticate, function(req, res, next) {
    db.listUsers(function(err, result) {
      if (err) return next(err);
      var users = _.map(result, function(user) {
        return filterUser(user);
      });
      res.send(users);
    });
  });

  app.get('/api/user/:id', authenticate, function(req, res, next) {
    db.getUser(req.params.id, function(err, user) {
      if (err) return next(err);
      if (!user) return res.send(404, 'User not found');
      res.send(filterUser(user));
    });
  });

  app.get('/api/message/', authenticate, function(req, res, next) {
    var options = {
      deleted: false,
      processed: true
    };
    db.listMessages(options, function(err, result) {
      if (err) return next(err);
      var messages = _.map(result.messages, function(message) {
        return filterMessage(message);
      });
      res.send(messages);
    });
  });

  app.get('/api/message/:id', authenticate, function(req, res, next) {
    db.getMessage(req.params.id, function(err, message) {
      if (err) return next(err);
      if (!message) return res.send(404, 'Message not found');
      res.send(filterMessage(message));
    });
  });

  app.get('/api/user/:userid/favorite/', authenticate, function(req, res, next) {
    var options = {
      deleted: false,
      processed: true,
      favorite: req.params.userid
    };
    db.listMessages(options, function(err, result) {
      if (err) return next(err);
      var messages = _.map(result.messages, function(message) {
        return filterMessage(message);
      });
      res.send(messages);
    });
  });

  app.post('/api/user/:userid/favorite/:msgid', authenticate, function(req, res, next) {
    if (parseInt(req.params.userid) !== req.user.id) {
      return res.send(403, 'Forbidden to edit this user');
    }
    db.setFavorite(req.params.userid, req.params.msgid, function(err) {
      if (err) return next(err);
      res.send(204);
    });
  });

  app.delete('/api/user/:userid/favorite/:msgid', authenticate, function(req, res, next) {
    if (parseInt(req.params.userid) !== req.user.id) {
      return res.send(403, 'Forbidden to edit this user');
    }
    db.deleteFavorite(req.params.userid, req.params.msgid, function(err) {
      if (err) return next(err);
      res.send(204);
    });
  });



  function generateOrderBy(str) {
    var mapping = {
      id: 'message.id',
      title: 'message.title',
      author: 'message.author',
      timestamp: 'message.timestamp',
      favorited: 'COUNT(favorite.user_id)'
    };
    var order_by = _.compact(_.map(str.split(','), function(orderitem) {
      orderitem = orderitem.toLowerCase();
      var splitted = orderitem.split('_');
      if (!mapping[splitted[0]]) return;
      if (splitted.length < 2 || splitted[1] !== 'desc') splitted[1] = 'asc';
      return mapping[splitted[0]]+' '+splitted[1].toUpperCase();
    }));
    return order_by;
  }

  function generateSearchOptions(req) {
    var options = {
      deleted: false,
      processed: true
    };
    if (/\d+/.test(req.query.from)) options.from = new Date(parseInt(req.query.from));
    if (/\d+/.test(req.query.until)) options.until = new Date(parseInt(req.query.until));
    if (req.query.limit) options.limit = req.query.limit;
    if (req.query.offset) options.offset = req.query.offset;
    if (req.query.key) options.search = req.query.key;
    if (req.query.order_by) {
      options.order_by = generateOrderBy(req.query.order_by);
    } else {
      options.order_by = [];
    }
    return options;
  }

  app.get('/api/search/messages', authenticate, function(req, res, next) {
    db.listMessages(generateSearchOptions(req), function(err, result) {
      if (err) return next(err);
      res.send(filterSearchResult(result, req.query));
    });
  });

  app.get('/api/search/images', authenticate, function(req, res, next) {
    db.listImages(generateSearchOptions(req), function(err, result) {
      if (err) return next(err);
      res.send(filterSearchResult(result, req.query));
    });
  });

  app.get('/api/search/videos', authenticate, function(req, res, next) {
    db.listVideos(generateSearchOptions(req), function(err, result) {
      if (err) return next(err);
      res.send(filterSearchResult(result, req.query));
    });
  });

  app.get('/api/search/favorites', authenticate, function(req, res, next) {
    var options = generateSearchOptions(req);
    options.favorite = true;
    db.listMessages(options, function(err, result) {
      if (err) return next(err);
      res.send(filterSearchResult(result, req.query));
    });
  });

  app.get('/api/search/favorites/:userid', authenticate, function(req, res, next) {
    var options = generateSearchOptions(req);
    options.favorite = req.params.userid;
    options.order_by.push('favorite.timestamp DESC');
    db.listMessages(options, function(err, result) {
      if (err) return next(err);
      res.send(filterSearchResult(result, req.query));
    });
  });



  app.get('/image/:id', authenticate, function(req, res, next) {
    db.getImagePath(req.params.id, function(err, path) {
      if (err) return next(err);
      if (!path) return res.send(404, 'Image not found');
      res.sendfile(path);
    });
  });

  app.get('/image/:id/:size', authenticate, function(req, res, next) {
    db.getImagePath(req.params.id, req.params.size, function(err, path) {
      if (err) return next(err);
      if (!path) return res.send(404, 'Image not found');
      res.sendfile(path);
    });
  });

  app.get('/video/:id', authenticate, function(req, res, next) {
    db.getVideoPath(req.params.id, function(err, path) {
      if (err) return next(err);
      if (!path) return res.send(404, 'Video not found');
      res.sendfile(path);
    });
  });

  app.get('/video/:id/:format', authenticate, function(req, res, next) {
    db.getVideoPath(req.params.id, req.params.format, function(err, path) {
      if (err) return next(err);
      if (!path) return res.send(404, 'Video not found');
      res.sendfile(path);
    });
  });
};

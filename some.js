 var getUniqueValue = function (entity) {
            return primaryKeyProperties.reduce(function (current, next) {
                return current += entity[next];
            }, "");
        };
        
        var setUniqueValues = function (entity) {
            primaryKeyProperties.forEach(function (key) {
                if (typeof entity[key] === "undefined" || entity[key] === null) {
                    entity[key] = createPrimaryKey(key);
                }
            });
        };
        
        self.add = function (entity) {
            var result;
            if (!entity) {
                var error = new ErrorResponse("An Entity cannot be null or undefined.");
                result = Future.fromError(error);
            } else {
                var id = getUniqueValue(entity);
                
                if (entities.hasKey(id)) {
                    var error = new ErrorResponse("An Entity with that key already exists.");
                    result = Future.fromError(error);
                } else {
                    var clone = convertDtoToJavascriptEntity(Type, entity);
                    setUniqueValues(clone);
                    id = getUniqueValue(clone);
                    
                    entities.add(id, clone);
                    result = Future.fromResult(new AddedResponse("Successfully added enity.", clone));
                    
                    self.notify({
                        type: "added",
                        entity: clone
                    });
                }
            }
            return result;
        };
        
        self.update = function (entity, updates) {
            var result;
            var id = getUniqueValue(entity);
            
            var inMemoryEntity = entities.get(id);
            
            if (inMemoryEntity) {
                Object.keys(updates).forEach(function (key) {
                    inMemoryEntity[key] = updates[key];
                });
                
                result = Future.fromResult(new UpdatedResponse("Update was successful."));
                
                self.notify({
                    type: "updated",
                    id: id,
                    updates: updates
                });

            } else {
                result = Future.fromError(new ErrorResponse("Unknown entity, couldn't update."));
            }
            
            return result;
        };
        
        self.remove = function (entity) {
            var id = getUniqueValue(entity);
            var result;
            var hasKey = entities.hasKey(id);
            
            if (hasKey) {
                entities.remove(id);
                result = Future.fromResult(new RemovedResponse("Entity was successfully removed."));
                
                self.notify({
                    type: "removed",
                    entity: entity
                });

            } else {
                result = Future.fromError(new ErrorResponse("Unknown entity, couldn't remove."));
            }
            
            return result;
        };
        
        self.asQueryable = function () {
            var queryable = new Queryable(Type);
            queryable.provider = self.getQueryProvider();
            
            return queryable;
        };
        
        self.getQueryProvider = function () {
            return provider;
        };
        
        self.getEntities = function () {
            return entities;
        };
        
        self.setEntities = function (value) {
            if (value instanceof Hashmap) {
                entities = value;
            } else {
                throw new Error("Expected a Hashmap.");
            }
        };

Backbone.Validation = (function (_) {

    'use strict';

    // Default options
    // ---------------

    var defaultOptions = {
        forceUpdate: false,
        selector: 'name',
        labelFormatter: 'sentenceCase',
        valid: Function.prototype,
        invalid: Function.prototype
    };


    // Helper functions
    // ----------------

    // Formatting functions used for formatting error messages
    var formatFunctions = {
        // Uses the configured label formatter to format the attribute name
        // to make it more readable for the user
        formatLabel: function (attrName, model) {
            return defaultLabelFormatters[defaultOptions.labelFormatter](attrName, model);
        },

        // Replaces nummeric placeholders like {0} in a string with arguments
        // passed to the function
        format: function () {
            var args = Array.prototype.slice.call(arguments),
                text = args.shift();
            return text.replace(/\{(\d+)\}/g, function (match, number) {
                return typeof args[number] !== 'undefined' ? args[number] : match;
            });
        }
    };

    // Flattens an object
    // eg:
    //
    //     var o = {
    //       address: {
    //         street: 'Street',
    //         zip: 1234
    //       }
    //     };
    //
    // becomes:
    //
    //     var o = {
    //       'address.street': 'Street',
    //       'address.zip': 1234
    //     };
    var flatten = function (obj, into, prefix) {
        into = into || {};
        prefix = prefix || '';

        _.each(obj, function (val, key) {
            if (obj.hasOwnProperty(key)) {
                if (val && typeof val === 'object' && !(
                    val instanceof Date ||
                        val instanceof RegExp ||
                        val instanceof Backbone.Model ||
                        val instanceof Backbone.Collection)
                    ) {
                    flatten(val, into, prefix + key + '.');
                }
                else {
                    into[prefix + key] = val;
                }
            }
        });

        return into;
    };

    // Validation
    // ----------

    var Validation = (function () {

        // Returns an object with undefined properties for all
        // attributes on the model that has defined one or more
        // validation rules.
        var getValidatedAttrs = function (model) {
            return _.reduce(_.keys(model.validation || {}), function (memo, key) {
                memo[key] = void 0;
                return memo;
            }, {});
        };

        // Looks on the model for validations for a specified
        // attribute. Returns an array of any validators defined,
        // or an empty array if none is defined.
        var getValidators = function (model, attr) {
            var attrValidationSet = model.validation ? model.validation[attr] || {} : {};

            // If the validator is a function or a string, wrap it in a function validator
            if (_.isFunction(attrValidationSet) || _.isString(attrValidationSet)) {
                attrValidationSet = {
                    fn: attrValidationSet
                };
            }

            // Stick the validator object into an array
            if (!_.isArray(attrValidationSet)) {
                attrValidationSet = [attrValidationSet];
            }

            // Reduces the array of validators into a new array with objects
            // with a validation method to call, the value to validate against
            // and the specified error message, if any
            return _.reduce(attrValidationSet, function (memo, attrValidation) {
                _.each(_.without(_.keys(attrValidation), 'msg'), function (validator) {
                    memo.push({
                        fn: defaultValidators[validator],
                        val: attrValidation[validator],
                        msg: attrValidation.msg
                    });
                });
                return memo;
            }, []);
        };

        // Validates an attribute against all validators defined
        // for that attribute. If one or more errors are found,
        // the first error message is returned.
        // If the attribute is valid, an empty string is returned.
        var validateAttr = function (masterDeferred, model, attr, value, computed) {

            var validators = getValidators(model, attr);

            if (validators.length === 0) {
                masterDeferred.resolve();
            } else {
                var invokeValidator = function (validator) {
                    var result = $.Deferred();

                    // Create a promise for our deferred validation so that
                    // we can properly bind to the resolve / reject handlers
                    // for the validation step.
                    result.promise().then(
                        function (/* Resolve arguments. */) {

                            // This validation passed. Now, let's see if we
                            // have another validation to execute.
                            var nextValidation = validators.shift();

                            // Check for a next validation.
                            if (nextValidation) {

                                // Recusively invoke the validation. When we
                                // do this, we want to pass-through the
                                // previous validation result in case it is
                                // needed by the next step.
                                return(
                                    invokeValidator(nextValidation)
                                    );

                            }

                            // No more validation steps are provided. We can
                            // therefore consider the validation process to
                            // be resolved. Resolve the master deferred.
                            masterDeferred.resolve();

                        },
                        function (errorMessage) {

                            // Reject the master deferred.
                            masterDeferred.reject(validator.msg);

                        }
                    );

                    // While the validation is intended to be asynchronous,
                    // let's catch any synchronous errors.
                    try {

                        var ctx = _.extend({}, formatFunctions, defaultValidators);

                        // Call the validator.
                        validator.fn.call(ctx, result, value, attr, validator.val, model, computed);

                    } catch (syncError) {

                        // If there was a synchronous error in the callback
                        // that was not caught, let's return a 500 server
                        // response error.
                        masterDeferred.reject(validator.msg);

                    }

                };

                // Invoke the first validator.
                invokeValidator(validators.shift());
            }

            return( masterDeferred.promise() );


            // Return the promise of the master deferred object.
        };


        // Loops through the model's attributes and validates them all.
        // Returns and object containing names of invalid attributes
        // as well as error messages.
        var validateModel = function (model, attrs) {

            var masterDeferred = $.Deferred();

            var error,
                invalidAttrs = {},
                isValid = true,
                computed = _.clone(attrs),
                flattened = flatten(attrs);

            // Convert an object into a list of [key, value] pairs.
            var pairs = _.pairs(flattened);

            var invokeModel = function (pair) {
                var attr = pair[0];
                var value = pair[1];
                var result = $.Deferred();

                // Create a promise for our deferred validation so that
                // we can properly bind to the resolve / reject handlers
                // for the validation step.
                result.promise().then(
                    function (/* Resolve arguments. */) {

                        var nextPair = pairs.shift();

                        // Check for a next validation.
                        if (nextPair) {

                            // Recusively invoke the validation. When we
                            // do this, we want to pass-through the
                            // previous validation result in case it is
                            // needed by the next step.
                            return(
                                invokeModel(nextPair)
                                );

                        }

                        // No more validation steps are provided. We can
                        // therefore consider the validation process to
                        // be resolved. Resolve the master deferred.
                        masterDeferred.resolve({
                            invalidAttrs: invalidAttrs,
                            isValid: isValid
                        });

                    },
                    function (errorMessage) {

                        invalidAttrs[attr] = errorMessage;
                        isValid = false;

                        var nextPair = pairs.shift();

                        // Check for a next validation.
                        if (nextPair) {

                            // Recusively invoke the validation. When we
                            // do this, we want to pass-through the
                            // previous validation result in case it is
                            // needed by the next step.
                            return(
                                invokeModel(nextPair)
                                );

                        }

                        // No more validation steps are provided. We can
                        // therefore consider the validation process to
                        // be resolved. Resolve the master deferred.
                        masterDeferred.resolve({
                            invalidAttrs: invalidAttrs,
                            isValid: isValid
                        });

                    }
                );

                validateAttr(result, model, attr, value, computed);

            };

            invokeModel(pairs.shift());

            return masterDeferred.promise();
        };

        // Contains the methods that are mixed in on the model when binding
        var mixin = function (view, options) {
            return {

                // Check whether or not a value passes validation
                // without updating the model
                preValidate: function (attr, value) {
                    return validateAttr($.Deferred(),this, attr, value, _.extend({}, this.attributes));
                },

                // Check to see if an attribute, an array of attributes or the
                // entire model is valid. Passing true will force a validation
                // of the model.
                isValid: function (option) {
                    var flattened = flatten(this.attributes);

                    if (_.isString(option)) {
                        return !validateAttr(this, option, flattened[option], _.extend({}, this.attributes));
                    }
                    if (_.isArray(option)) {
                        return _.reduce(option, function (memo, attr) {
                            return memo && !validateAttr(this, attr, flattened[attr], _.extend({}, this.attributes));
                        }, true, this);
                    }
                    if (option === true) {
                        this.validate();
                    }
                    return this.validation ? this._isValid : true;
                },

                // This is called by Backbone when it needs to perform validation.
                // You can call it manually without any parameters to validate the
                // entire model.
                validate: function (attrs, setOptions) {
                    var model = this,
                        validateAll = !attrs,
                        opt = _.extend({}, options, setOptions),
                        validatedAttrs = getValidatedAttrs(model),
                        allAttrs = _.extend({}, validatedAttrs, model.attributes, attrs),
                        changedAttrs = flatten(attrs || allAttrs);

                    var deferred = $.Deferred();

                    validateModel(model, allAttrs).then(
                        function(result) {
                            model._isValid = result.isValid;

                            // After validation is performed, loop through all changed attributes
                            // and call the valid callbacks so the view is updated.
                            _.each(validatedAttrs, function (val, attr) {
                                var invalid = result.invalidAttrs.hasOwnProperty(attr);
                                if (!invalid) {
                                    opt.valid(view, attr, opt.selector);
                                }
                            });

                            // After validation is performed, loop through all changed attributes
                            // and call the invalid callback so the view is updated.
                            _.each(validatedAttrs, function (val, attr) {
                                var invalid = result.invalidAttrs.hasOwnProperty(attr),
                                    changed = changedAttrs.hasOwnProperty(attr);

                                if (invalid && (changed || validateAll)) {
                                    opt.invalid(view, attr, result.invalidAttrs[attr], opt.selector);
                                }
                            });

                            // Trigger validated events.
                            // Need to defer this so the model is actually updated before
                            // the event is triggered.
                            _.defer(function () {
                                model.trigger('validated', model._isValid, model, result.invalidAttrs);
                                model.trigger('validated:' + (model._isValid ? 'valid' : 'invalid'), model, result.invalidAttrs);
                            });

                            // Return any error messages to Backbone, unless the forceUpdate flag is set.
                            // Then we do not return anything and fools Backbone to believe the validation was
                            // a success. That way Backbone will update the model regardless.
                            if (!opt.forceUpdate && _.intersection(_.keys(result.invalidAttrs), _.keys(changedAttrs)).length > 0) {
                                return result.invalidAttrs;
                            }

                            if (model._isValid) {
                                deferred.resolve();
                            } else {
                                deferred.reject();
                            }

                        }
                    );

                    return deferred.promise();

                }
            };
        };

        // Helper to mix in validation on a model
        var bindModel = function (view, model, options) {
            _.extend(model, mixin(view, options));
        };

        // Removes the methods added to a model
        var unbindModel = function (model) {
            delete model.validate;
            delete model.preValidate;
            delete model.isValid;
        };

        // Mix in validation on a model whenever a model is
        // added to a collection
        var collectionAdd = function (model) {
            bindModel(this.view, model, this.options);
        };

        // Remove validation from a model whenever a model is
        // removed from a collection
        var collectionRemove = function (model) {
            unbindModel(model);
        };

        // Returns the public methods on Backbone.Validation
        return {

            // Current version of the library
            version: '0.8.0',

            // Called to configure the default options
            configure: function (options) {
                _.extend(defaultOptions, options);
            },

            // Hooks up validation on a view with a model
            // or collection
            bind: function (view, options) {
                var model = view.model,
                    collection = view.collection;

                options = _.extend({}, defaultOptions, defaultCallbacks, options);

                if (typeof model === 'undefined' && typeof collection === 'undefined') {
                    throw 'Before you execute the binding your view must have a model or a collection.\n' +
                        'See http://thedersen.com/projects/backbone-validation/#using-form-model-validation for more information.';
                }

                if (model) {
                    bindModel(view, model, options);
                }
                else if (collection) {
                    collection.each(function (model) {
                        bindModel(view, model, options);
                    });
                    collection.bind('add', collectionAdd, {view: view, options: options});
                    collection.bind('remove', collectionRemove);
                }
            },

            // Removes validation from a view with a model
            // or collection
            unbind: function (view) {
                var model = view.model,
                    collection = view.collection;

                if (model) {
                    unbindModel(view.model);
                }
                if (collection) {
                    collection.each(function (model) {
                        unbindModel(model);
                    });
                    collection.unbind('add', collectionAdd);
                    collection.unbind('remove', collectionRemove);
                }
            },

            // Used to extend the Backbone.Model.prototype
            // with validation
            mixin: mixin(null, defaultOptions)
        };
    }());


    // Callbacks
    // ---------

    var defaultCallbacks = Validation.callbacks = {

        // Gets called when a previously invalid field in the
        // view becomes valid. Removes any error message.
        // Should be overridden with custom functionality.
        valid: function (view, attr, selector) {
            view.$('[' + selector + '~="' + attr + '"]')
                .removeClass('invalid')
                .removeAttr('data-error');
        },

        // Gets called when a field in the view becomes invalid.
        // Adds a error message.
        // Should be overridden with custom functionality.
        invalid: function (view, attr, error, selector) {
            view.$('[' + selector + '~="' + attr + '"]')
                .addClass('invalid')
                .attr('data-error', error);
        }
    };


    // Patterns
    // --------

    var defaultPatterns = Validation.patterns = {
        // Matches any digit(s) (i.e. 0-9)
        digits: /^\d+$/,

        // Matched any number (e.g. 100.000)
        number: /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/,

        // Matches a valid email address (e.g. mail@example.com)
        email: /^((([a-z]|\d|[!#\$%&'\*\+\-\/=\?\^_`{\|}~]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])+(\.([a-z]|\d|[!#\$%&'\*\+\-\/=\?\^_`{\|}~]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])+)*)|((\x22)((((\x20|\x09)*(\x0d\x0a))?(\x20|\x09)+)?(([\x01-\x08\x0b\x0c\x0e-\x1f\x7f]|\x21|[\x23-\x5b]|[\x5d-\x7e]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(\\([\x01-\x09\x0b\x0c\x0d-\x7f]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]))))*(((\x20|\x09)*(\x0d\x0a))?(\x20|\x09)+)?(\x22)))@((([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])))\.)+(([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])))$/i,

        // Mathes any valid url (e.g. http://www.xample.com)
        url: /^(https?|ftp):\/\/(((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:)*@)?(((\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5]))|((([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])))\.)+(([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])))\.?)(:\d*)?)(\/((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)+(\/(([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)*)*)?)?(\?((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)|[\uE000-\uF8FF]|\/|\?)*)?(\#((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)|\/|\?)*)?$/i
    };


    // Error messages
    // --------------

    // Error message for the build in validators.
    // {x} gets swapped out with arguments form the validator.
    var defaultMessages = Validation.messages = {
        required: '{0} is required',
        acceptance: '{0} must be accepted',
        min: '{0} must be greater than or equal to {1}',
        max: '{0} must be less than or equal to {1}',
        range: '{0} must be between {1} and {2}',
        length: '{0} must be {1} characters',
        minLength: '{0} must be at least {1} characters',
        maxLength: '{0} must be at most {1} characters',
        rangeLength: '{0} must be between {1} and {2} characters',
        oneOf: '{0} must be one of: {1}',
        equalTo: '{0} must be the same as {1}',
        pattern: '{0} must be a valid {1}'
    };

    // Label formatters
    // ----------------

    // Label formatters are used to convert the attribute name
    // to a more human friendly label when using the built in
    // error messages.
    // Configure which one to use with a call to
    //
    //     Backbone.Validation.configure({
    //       labelFormatter: 'label'
    //     });
    var defaultLabelFormatters = Validation.labelFormatters = {

        // Returns the attribute name with applying any formatting
        none: function (attrName) {
            return attrName;
        },

        // Converts attributeName or attribute_name to Attribute name
        sentenceCase: function (attrName) {
            return attrName.replace(/(?:^\w|[A-Z]|\b\w)/g,function (match, index) {
                return index === 0 ? match.toUpperCase() : ' ' + match.toLowerCase();
            }).replace('_', ' ');
        },

        // Looks for a label configured on the model and returns it
        //
        //      var Model = Backbone.Model.extend({
        //        validation: {
        //          someAttribute: {
        //            required: true
        //          }
        //        },
        //
        //        labels: {
        //          someAttribute: 'Custom label'
        //        }
        //      });
        label: function (attrName, model) {
            return (model.labels && model.labels[attrName]) || defaultLabelFormatters.sentenceCase(attrName, model);
        }
    };


    // Built in validators
    // -------------------

    var defaultValidators = Validation.validators = (function () {
        // Use native trim when defined
        var trim = String.prototype.trim ?
            function (text) {
                return text === null ? '' : String.prototype.trim.call(text);
            } :
            function (text) {
                var trimLeft = /^\s+/,
                    trimRight = /\s+$/;

                return text === null ? '' : text.toString().replace(trimLeft, '').replace(trimRight, '');
            };

        // Determines whether or not a value is a number
        var isNumber = function (value) {
            return _.isNumber(value) || (_.isString(value) && value.match(defaultPatterns.number));
        };

        // Determines whether or not not a value is empty
        var hasValue = function (value) {
            return !(_.isNull(value) || _.isUndefined(value) || (_.isString(value) && trim(value) === ''));
        };

        return {
            // Function validator
            // Lets you implement a custom function used for validation
            fn: function (validator, value, attr, fn, model, computed) {
                if (_.isString(fn)) {
                    fn = model[fn];
                }
                return fn(validator, model, value, attr, computed);
            },

            // Required validator
            // Validates if the attribute is required or not
            required: function (validation, value, attr, required, model, computed) {
                var isRequired = _.isFunction(required) ? required.call(model, value, attr, computed) : required;
                if (!isRequired && !hasValue(value)) {
                    return validation.resolve(); // overrides all other validators
                }
                if (isRequired && !hasValue(value)) {
                    var message = this.format(defaultMessages.required, this.formatLabel(attr, model));
                    return validation.reject(message);
                }
                return validation.resolve();
            },

            // Acceptance validator
            // Validates that something has to be accepted, e.g. terms of use
            // `true` or 'true' are valid
            acceptance: function (validation, value, attr, accept, model) {
                if (value !== 'true' && (!_.isBoolean(value) || value === false)) {
                    return validation.reject(this.format(defaultMessages.acceptance, this.formatLabel(attr, model)));
                }
                return validation.resolve();
            },

            // Min validator
            // Validates that the value has to be a number and equal to or greater than
            // the min value specified
            min: function (validation, value, attr, minValue, model) {
                if (!isNumber(value) || value < minValue) {
                    return validation.reject(this.format(defaultMessages.min, this.formatLabel(attr, model), minValue));
                }
                return validation.resolve();
            },

            // Max validator
            // Validates that the value has to be a number and equal to or less than
            // the max value specified
            max: function (validation, value, attr, maxValue, model) {
                if (!isNumber(value) || value > maxValue) {
                    return validation.reject(this.format(defaultMessages.max, this.formatLabel(attr, model), maxValue));
                }
                return validation.resolve();
            },

            // Range validator
            // Validates that the value has to be a number and equal to or between
            // the two numbers specified
            range: function (validation, value, attr, range, model) {
                if (!isNumber(value) || value < range[0] || value > range[1]) {
                    return validation.reject(this.format(defaultMessages.range, this.formatLabel(attr, model), range[0], range[1]));
                }
                return validation.resolve();
            },

            // Length validator
            // Validates that the value has to be a string with length equal to
            // the length value specified
            length: function (validation, value, attr, length, model) {
                if (!hasValue(value) || trim(value).length !== length) {
                    return validation.reject(this.format(defaultMessages.length, this.formatLabel(attr, model), length));
                }
                return validation.resolve();
            },

            // Min length validator
            // Validates that the value has to be a string with length equal to or greater than
            // the min length value specified
            minLength: function (validation, value, attr, minLength, model) {
                if (!hasValue(value) || trim(value).length < minLength) {
                    return validation.reject(this.format(defaultMessages.minLength, this.formatLabel(attr, model), minLength));
                }
                return validation.resolve();
            },

            // Max length validator
            // Validates that the value has to be a string with length equal to or less than
            // the max length value specified
            maxLength: function (validation, value, attr, maxLength, model) {
                if (!hasValue(value) || trim(value).length > maxLength) {
                    return validation.reject(this.format(defaultMessages.maxLength, this.formatLabel(attr, model), maxLength));
                }
                return validation.resolve();
            },

            // Range length validator
            // Validates that the value has to be a string and equal to or between
            // the two numbers specified
            rangeLength: function (validation, value, attr, range, model) {
                if (!hasValue(value) || trim(value).length < range[0] || trim(value).length > range[1]) {
                    return validation.reject(this.format(defaultMessages.rangeLength, this.formatLabel(attr, model), range[0], range[1]));
                }
                return validation.resolve();
            },

            // One of validator
            // Validates that the value has to be equal to one of the elements in
            // the specified array. Case sensitive matching
            oneOf: function (validation, value, attr, values, model) {
                if (!_.include(values, value)) {
                    return validation.reject(this.format(defaultMessages.oneOf, this.formatLabel(attr, model), values.join(', ')));
                }
                return validation.resolve();
            },

            // Equal to validator
            // Validates that the value has to be equal to the value of the attribute
            // with the name specified
            equalTo: function (validation, value, attr, equalTo, model, computed) {
                if (value !== computed[equalTo]) {
                    return validation.reject(this.format(defaultMessages.equalTo, this.formatLabel(attr, model), this.formatLabel(equalTo, model)));
                }
                return validation.resolve();
            },

            // Pattern validator
            // Validates that the value has to match the pattern specified.
            // Can be a regular expression or the name of one of the built in patterns
            pattern: function (validation, value, attr, pattern, model) {
                if (!hasValue(value) || !value.toString().match(defaultPatterns[pattern] || pattern)) {
                    return validation.reject(this.format(defaultMessages.pattern, this.formatLabel(attr, model), pattern));
                }
                return validation.resolve();
            }
        };
    }());

    return Validation;
    
}(_));

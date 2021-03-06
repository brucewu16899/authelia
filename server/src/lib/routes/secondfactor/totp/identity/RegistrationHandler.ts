
import express = require("express");
import BluebirdPromise = require("bluebird");
import objectPath = require("object-path");

import { Identity } from "../../../../../../types/Identity";
import { IdentityValidable } from "../../../../IdentityCheckMiddleware";
import { PRE_VALIDATION_TEMPLATE } from "../../../../IdentityCheckPreValidationTemplate";
import Constants = require("../constants");
import Endpoints = require("../../../../../../../shared/api");
import ErrorReplies = require("../../../../ErrorReplies");
import { AuthenticationSessionHandler } from "../../../../AuthenticationSessionHandler";
import UserMessages = require("../../../../../../../shared/UserMessages");
import FirstFactorValidator = require("../../../../FirstFactorValidator");
import { IRequestLogger } from "../../../../logging/IRequestLogger";
import { IUserDataStore } from "../../../../storage/IUserDataStore";
import { ITotpHandler } from "../../../../authentication/totp/ITotpHandler";
import { TOTPSecret } from "../../../../../../types/TOTPSecret";
import { TOTPConfiguration } from "../../../../configuration/Configuration";


export default class RegistrationHandler implements IdentityValidable {
  private logger: IRequestLogger;
  private userDataStore: IUserDataStore;
  private totp: ITotpHandler;
  private configuration: TOTPConfiguration;

  constructor(logger: IRequestLogger,
    userDataStore: IUserDataStore,
    totp: ITotpHandler, configuration: TOTPConfiguration) {
    this.logger = logger;
    this.userDataStore = userDataStore;
    this.totp = totp;
    this.configuration = configuration;
  }

  challenge(): string {
    return Constants.CHALLENGE;
  }

  private retrieveIdentity(req: express.Request): BluebirdPromise<Identity> {
    const that = this;
    return new BluebirdPromise(function (resolve, reject) {
      const authSession = AuthenticationSessionHandler.get(req, that.logger);
      const userid = authSession.userid;
      const email = authSession.email;

      if (!(userid && email)) {
        return reject(new Error("User ID or email is missing"));
      }

      const identity = {
        email: email,
        userid: userid
      };
      return resolve(identity);
    });
  }

  preValidationInit(req: express.Request): BluebirdPromise<Identity> {
    const that = this;
    return FirstFactorValidator.validate(req, this.logger)
      .then(function () {
        return that.retrieveIdentity(req);
      });
  }

  preValidationResponse(req: express.Request, res: express.Response) {
    res.render(PRE_VALIDATION_TEMPLATE);
  }

  postValidationInit(req: express.Request) {
    return FirstFactorValidator.validate(req, this.logger);
  }

  postValidationResponse(req: express.Request, res: express.Response)
    : BluebirdPromise<void> {
    const that = this;
    let secret: TOTPSecret;
    let userId: string;
    return new BluebirdPromise(function (resolve, reject) {
      const authSession = AuthenticationSessionHandler.get(req, that.logger);
      userId = authSession.userid;

      if (authSession.identity_check.challenge != Constants.CHALLENGE
        || !userId)
        return reject(new Error("Bad challenge."));

      resolve();
    })
      .then(function () {
        secret = that.totp.generate(userId,
          that.configuration.issuer);
        that.logger.debug(req, "Save the TOTP secret in DB");
        return that.userDataStore.saveTOTPSecret(userId, secret);
      })
      .then(function () {
        AuthenticationSessionHandler.reset(req);

        res.render(Constants.TEMPLATE_NAME, {
          base32_secret: secret.base32,
          otpauth_url: secret.otpauth_url,
          login_endpoint: Endpoints.FIRST_FACTOR_GET
        });
      })
      .catch(ErrorReplies.replyWithError200(req, res, that.logger, UserMessages.OPERATION_FAILED));
  }

  mailSubject(): string {
    return "Set up Authelia's one-time password";
  }
}
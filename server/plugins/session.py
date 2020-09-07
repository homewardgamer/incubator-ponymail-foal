#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Licensed to the Apache Software Foundation (ASF) under one or more
# contributor license agreements.  See the NOTICE file distributed with
# this work for additional information regarding copyright ownership.
# The ASF licenses this file to You under the Apache License, Version 2.0
# (the "License"); you may not use this file except in compliance with
# the License.  You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""This is the user session handler for PyPony"""

import http.cookies
import time
import typing
import uuid

import aiohttp.web

import plugins.database
import plugins.server
import copy

FOAL_MAX_SESSION_AGE = 86400 * 7  # Max 1 week between visits before voiding a session
FOAL_SAVE_SESSION_INTERVAL = 3600  # Update sessions on disk max once per hour


class SessionCredentials:
    uid: str
    name: str
    email: str
    provider: str
    authoritative: bool
    admin: bool
    oauth_data: dict

    def __init__(self, doc):
        if doc:
            self.uid = doc.get("uid", "")
            self.name = doc.get("name", "")
            self.email = doc.get("email", "")
            self.oauth_provider = doc.get("oauth_provider", "generic")
            self.authoritative = doc.get("authoritative", False)
            self.admin = doc.get("admin", False)
            self.oauth_data = doc.get("oauth_data", {})
        else:
            self.uid = ""
            self.name = ""
            self.email = ""
            self.oauth_provider = "generic"
            self.authoritative = False
            self.admin = False
            self.oauth_data = {}


class SessionObject:
    cid: str
    cookie: str
    created: int
    last_accessed: int
    credentials: SessionCredentials
    database: typing.Optional[plugins.database.Database]

    def __init__(self, server: plugins.server.BaseServer, **kwargs):
        self.database = None
        if not kwargs:
            now = int(time.time())
            self.created = now
            self.last_accessed = now
            self.credentials = None
            self.cookie = str(uuid.uuid4())
            self.cid = None
        else:
            self.last_accessed = kwargs.get("last_accessed")
            self.credentials = SessionCredentials(kwargs.get("credentials"))
            self.cookie = kwargs.get("cookie")
            self.cid = kwargs.get("cid")


async def get_session(
    server: plugins.server.BaseServer, request: aiohttp.web.BaseRequest
) -> SessionObject:
    session_id = None
    session = None
    now = int(time.time())
    if request.headers.get("cookie"):
        for cookie_header in request.headers.getall("cookie"):
            cookies: http.cookies.SimpleCookie = http.cookies.SimpleCookie(
                cookie_header
            )
            if "ponymail" in cookies:
                session_id = cookies["ponymail"].value
                break

    # Do we have the session in local memory?
    if session_id in server.data.sessions:
        x_session = server.data.sessions[session_id]
        if (now - x_session.last_accessed) > FOAL_MAX_SESSION_AGE:
            del server.data.sessions[session_id]
        else:

            # Do we need to update the timestamp in ES?
            if (now - x_session.last_accessed) > FOAL_SAVE_SESSION_INTERVAL:
                x_session.last_accessed = now
                await save_session(x_session)

            # Make a copy so we don't have a race condition with the database pool object
            # In case the session is used twice within the same loop
            session = copy.copy(x_session)
            session.database = await server.dbpool.get()
            return session

    # If not in local memory, start a new session object
    session = SessionObject(server)
    session.database = await server.dbpool.get()

    # If a cookie was supplied, look for a session object in ES
    if session_id:
        try:
            session_doc = await session.database.get(
                session.database.dbs.session, id=session_id
            )
            last_update = session_doc["_source"]["updated"]
            session.cookie = session_id
            # Check that this cookie ain't too old. If it is, delete it and return bare-bones session object
            if (now - last_update) > FOAL_MAX_SESSION_AGE:
                session.database.delete(
                    index=session.database.dbs.session, id=session_id
                )
                return session

            # Get CID and fecth the account data
            cid = session_doc["_source"]["cid"]
            if cid:
                account_doc = await session.database.get(session.database.dbs.account, id=cid)
                creds = account_doc["_source"]['credentials']
                internal = account_doc['_source']['internal']

                # Set session data
                session.cid = cid
                session.last_accessed = last_update
                creds["authoritative"] = (
                    internal.get("oauth_provider") in server.config.oauth.authoritative_domains
                )
                creds['oauth_provider'] = internal.get('oauth_provider', 'generic')
                creds['oauth_data'] = internal.get('oauth_data', {})
                session.credentials = SessionCredentials(creds)

                # Save in memory storage
                server.data.sessions[session_id] = session

        except plugins.database.DBError:
            pass
    return session


async def set_session(server: plugins.server.BaseServer, cid, **credentials):
    """Create a new user session in the database"""
    session_id = str(uuid.uuid4())
    cookie: http.cookies.SimpleCookie = http.cookies.SimpleCookie()
    cookie["ponymail"] = session_id
    session = SessionObject(server, last_accessed=time.time(), cookie=session_id, cid=cid)
    session.credentials = SessionCredentials(credentials)
    server.data.sessions[session_id] = session
    # Grab temporary DB handle
    session.database = await server.dbpool.get()

    # Save session and account data
    await save_session(session)
    await save_credentials(session)

    # Put DB handle back
    server.dbpool.put_nowait(session.database)
    return cookie["ponymail"].OutputString()


async def save_session(session: SessionObject):
    """Save a session object in the ES database"""
    await session.database.index(
        index=session.database.dbs.session,
        id=session.cookie,
        body={
            "cookie": session.cookie,
            "cid": session.cid,
            "updated": session.last_accessed,
        },
    )


async def remove_session(session: SessionObject):
    """Remove a session object in the ES database"""
    await session.database.delete(
        index=session.database.dbs.session,
        id=session.cookie
    )


async def save_credentials(session: SessionObject):
    """Save a user account object in the ES database"""
    await session.database.index(
        index=session.database.dbs.account,
        id=session.cid,
        body={
            "cid": session.cid,
            "credentials": {
                "email": session.credentials.email,
                "name": session.credentials.name,
                "uid": session.credentials.uid,
            },
            "internal": {
                "oauth_provider": session.credentials.oauth_provider,
                "oauth_data": session.credentials.oauth_data,
            }
        },
    )

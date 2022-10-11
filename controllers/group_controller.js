const { neo4j, driver } = require('../config/neo4j');
const Admin = require('../models/admin_model');
const Graph = require('../models/graph_model');
const pool = require('../config/mysql');
const Mapping = require('../config/mapping');

const createGroup = async (req, res) => {
    const group_name = req.body.group_name;
    const group_type = req.body.group_type;
    const groupUsers = req.body.groupUsers;
    const uid = req.user.id;
    console.info('controller: group_name, group_type, groupUsers: ', group_name, group_type, groupUsers);

    if (groupUsers.length < 2) {
        return res.status(400).json({ err: 'A Group should have at least two members.' });
    }

    //取得MySql&Neo連線並開始transaction
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    const session = driver.session();
    await session.writeTransaction(async (txc) => {
        //MySql建立group
        try {
            groupUsers.map((user) => {
                return user.uid === uid ? { uid: user.uid, role: Mapping.USER_ROLE.owner } : { uid: user.uid, role: Mapping.USER_ROLE.administer };
            });
            const groupResult = await Admin.createGroup(conn, group_name, group_type, groupUsers);
            if (!groupResult) {
                console.error(groupResult);
                throw new Error('Internal Server Error');
            }
            const gid = groupResult;
            const memberIds = groupUsers.map((user) => {
                return user.uid;
            });
            console.debug('to Neo:   ', gid, memberIds);

            //Neo4j建立節點
            let map = [];
            for (let memberId of memberIds) {
                // map.push({ name: neo4j.int(member.toSring()) }); //處理neo4j integer
                map.push({ name: neo4j.int(memberId) }); //處理neo4j integer
            }
            const graphResult = await Graph.createNodes(txc, neo4j.int(gid), map);
            if (!graphResult) {
                console.error(graphResult);
                throw new Error('Internal Server Error');
            }
            //全部成功了，commit
            conn.commit();
            await txc.commit();
            conn.release();
            session.close();
            return res.status(200).json({ data: { gid } });
        } catch (err) {
            console.error('ERROR: ', err);
            await conn.rollback();
            await txc.rollback();
            conn.release();
            session.close();
            return res.status(500).json({ err: 'Internal Server Error' });
        }
    });
};
const getGroupUsers = async (req, res) => {
    const gid = Number(req.params.id);
    console.info('control: gid:', gid);
    if (req.userGroupRole.gid != Number(req.params.id) || req.userGroupRole.role < Mapping.USER_ROLE['viewer']) {
        return res.status(403).json({ err: 'No authorization.' });
    }
    const members = await Admin.getGroupUsers(gid);
    if (!members) {
        console.error('getGroupUsers fail: ', members);
        return res.status(500).json({ err: 'Internal Server Error' });
    }
    return res.status(200).json({ data: members });
};
const updateGroup = async (req, res) => {
    const gid = Number(req.params.id);
    const group_name = req.body.group_name;
    const group_type = req.body.group_type;
    const groupUsers = req.body.groupUsers;
    console.info('controller: gid, group_name, group_type, groupUsers: ', gid, group_name, group_type, groupUsers);
    //取得MySql&Neo連線並開始transaction
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    const session = driver.session();
    //TODO:還要檢查
    await session.writeTransaction(async (txc) => {
        try {
            if (req.userGroupRole.gid != Number(req.params.id) || req.userGroupRole.role < Mapping.USER_ROLE['editor']) {
                return res.status(403).json({ err: 'No authorization.' });
            }

            const result = await Admin.updateGroup(gid, group_name);
            if (!result) {
                return res.status(500).json({ err: 'Internal Server Error' });
            }

            let groupUserIds = [];
            let map = [];
            for (let i = 0; i < req.body.groupUsers.length; i++) {
                const uid = groupUsers[i].uid;
                const role = Mapping.USER_ROLE.administer;
                console.log(uid, role);
                const insertId = await Admin.createMember(conn, gid, uid, role);
                if (!insertId) {
                    console.error('Admin.createMember result: ', insertId);
                    throw new Error('Internal Server Error');
                }
                console.log(insertId);
                groupUserIds.push(insertId);
                map.push({ name: neo4j.int(uid) }); //處理neo4j integer
            }
            const graphResult = Graph.createNodes(txc, gid, map);
            if (!graphResult) {
                console.error('Graph.createNodes result: ', debtsForUpdate);
                throw new Error('Internal Server Error');
            }
            //全部成功，MySQL做commit
            await conn.commit();
            await txc.commit();
            conn.release();
            session.close();
            return res.status(200).json({ data: groupUserIds });
        } catch (err) {
            console.error('ERROR: ', err);
            await conn.rollback();
            await txc.rollback();
            conn.release();
            session.close();
            return res.status(500).json({ err: 'Internal Server Error' });
        }
    });
};
const deleteMember = async (req, res) => {
    if (req.userGroupRole.gid != req.params.gid || req.userGroupRole.role < Mapping.USER_ROLE['administer']) {
        return res.status(403).json({ err: 'No authorization.' });
    }
    const groupId = req.params.gid;
    const userId = req.params.uid;
    console.info('controller: groupId, userId: ', groupId, userId);
    const result = await Admin.deleteMember(groupId, userId);
    if (!result) {
        return res.status(500).json({ err: 'Internal Server Error' });
    }
    return res.status(200).json({ data: null });
};

module.exports = { createGroup, getGroupUsers, updateGroup, deleteMember };

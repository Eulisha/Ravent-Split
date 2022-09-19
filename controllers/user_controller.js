const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const jwtSecret = process.env['JWT_SECRET_KEY'];
const jwtExpire = process.env['JWT_EXPIRE'];
const User = require('../models/user_model');

const signUp = async (req, res) => {
    console.log('sign-up body: ', req.body);

    const { email, password, name, cellphone, provider } = req.body;

    //確認email是否存在
    const checkExistResult = await User.checkExist(email);
    if (!checkExistResult) {
        return res.status(500).json({ err: checkExistResult });
    }
    if (checkExistResult.length !== 0) {
        return res.status(403).json({ err: 'Email already existed.' });
    }

    // 儲存前先hash密碼
    const hash = await bcrypt.hash(password, 10);

    // 儲存使用者
    const userId = await User.signUp(email, hash, name, cellphone, provider);
    console.log(userId);
    // 生成token

    const user = {
        id: userId,
        email,
        name,
        cellphone,
        picture: null,
        provider,
    };
    const token = jwt.sign(user, jwtSecret, {
        expiresIn: jwtExpire,
    });

    // 拋回前端
    return res.json({
        data: {
            accessToken: token,
            accessExpired: jwtExpire,
            user,
            userGroups: [],
        },
    });
};

const signIn = async (req, res) => {
    console.log('sign-in body :', req.body);

    const { email, password, provider } = req.body;

    //確認email是否存在
    const signInResult = await User.signIn(email);
    console.debug(signInResult);

    if (!signInResult) {
        return res.status(500).json({ err: 'Internal Server Eroor.' });
    }
    if (signInResult.length === 0) {
        return res.status(403).json({ err: 'Email not existed.' });
    }

    // hash密碼來驗證
    try {
        const hash = await bcrypt.compare(password, signInResult[0].password);
        if (!hash) {
            return res.status(403).json({ err: 'Password incorrect.' });
        }
    } catch (err) {
        console.log(err);
        return res.status(500).json({ err: 'Hash fail.' });
    }

    // get user-groups and roles
    const userGroups = await User.getUserGroups(signInResult[0].id);
    if (!userGroups) {
        return res.status(500).json({ error: 'Internal Server Error' });
    }

    //調整格式
    const user = {
        id: signInResult[0].id,
        email: signInResult[0].email,
        name: signInResult[0].name,
        cellphone: signInResult[0].cellphone,
        picture: signInResult[0].picture,
        provider: signInResult[0].provider,
    };

    // 生成token
    const token = jwt.sign(user, jwtSecret, {
        expiresIn: jwtExpire,
    });

    // 拋回前端
    return res.json({
        data: {
            accessToken: token,
            accessExpired: jwtExpire,
            user,
            userGroups,
        },
    });
};

const getUserInfo = async (req, res) => {
    //JWT解出的token
    let email = req.user.email;

    //確認使用者是否存在(與signIn共用function)
    const signInResult = await User.signIn(email);
    console.debug(signInResult);

    if (!signInResult) {
        return res.status(500).json({ err: 'Internal Server Eroor.' });
    }
    if (signInResult.length === 0) {
        return res.status(403).json({ err: 'JWT invalid.' });
    }

    // get user-groups and roles
    const userGroups = await User.getUserGroups(signInResult[0].id);
    if (!userGroups) {
        return res.status(500).json({ error: 'Internal Server Error' });
    }

    //調整格式
    const user = {
        id: signInResult[0].id,
        email: signInResult[0].email,
        name: signInResult[0].name,
        cellphone: signInResult[0].cellphone,
        picture: signInResult[0].picture,
        provider: signInResult[0].provider,
    };

    res.status(200).json({ data: req.user });
};
const getUserGroups = async (req, res) => {
    let uid = req.user.id;
    const groups = await User.getUserGroups(uid);
    if (!groups) {
        return res.status(500).json({ err: 'Internal Server Error' });
    }
    res.status(200).json({ data: groups });
};
const checkUserExist = async (req, res) => {
    const email = req.query.email;
    const [checkExistResult] = await User.checkExist(email);
    if (!checkExistResult) {
        return res.status(500).json({ err: checkExistResult });
    }
    if (checkExistResult.length === 0) {
        return res.status(400).json({ err: 'User not exist.' });
    }
    console.log(checkExistResult);
    res.status(200).json({ data: checkExistResult });
};
module.exports = { signUp, signIn, getUserInfo, getUserGroups, checkUserExist };
